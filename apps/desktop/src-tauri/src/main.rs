#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    Manager,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    menu::{Menu, MenuItem},
};
use tauri_plugin_shell::ShellExt;
use std::sync::Mutex;

struct GatewayState {
    child: Option<tauri_plugin_shell::process::CommandChild>,
    pid: Option<u32>,
}

fn kill_gateway(app: &tauri::AppHandle) {
    let state = app.state::<Mutex<GatewayState>>();
    let mut guard = state.lock().unwrap();
    let pid = match guard.pid.take() {
        Some(p) => p,
        None => return, // Already killed or never spawned
    };
    // Drop Tauri child handle without calling kill (we manage signals ourselves)
    let _ = guard.child.take();
    drop(guard); // Release lock before blocking

    let pid_i32 = pid as i32;
    // 1. SIGTERM → gateway runs cleanup (kills agent CLIs, saves state)
    unsafe { libc::kill(pid_i32, libc::SIGTERM); }
    println!("[desktop] Sent SIGTERM to gateway (pid={})", pid);
    // 2. Wait up to 2 seconds for graceful exit
    for _ in 0..20 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        if unsafe { libc::kill(pid_i32, 0) } != 0 {
            println!("[desktop] Gateway exited gracefully");
            return;
        }
    }
    // 3. Still alive after 2s — force kill entire process group
    unsafe { libc::kill(-pid_i32, libc::SIGKILL); }
    println!("[desktop] Gateway force-killed (SIGKILL)");
}

fn main() {
    let is_dev = cfg!(debug_assertions);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .manage(Mutex::new(GatewayState { child: None, pid: None }))
        .setup(move |app| {
            // -- System tray --
            let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        kill_gateway(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // -- Spawn gateway sidecar (production only) --
            if !is_dev {
                let resource_dir = app
                    .path()
                    .resource_dir()
                    .expect("failed to resolve resource dir");
                let sidecar_dir = resource_dir.join("sidecar");
                let node_bin = sidecar_dir.join("node");
                let gateway_js = sidecar_dir.join("gateway.js");
                let web_dir = sidecar_dir.join("web");

                // Resolve user's full PATH from login shell (macOS GUI apps only get /usr/bin:/bin)
                let full_path = std::process::Command::new("/bin/bash")
                    .args(["-l", "-c", "echo $PATH"])
                    .output()
                    .ok()
                    .and_then(|o| String::from_utf8(o.stdout).ok())
                    .map(|p| p.trim().to_string())
                    .unwrap_or_else(|| std::env::var("PATH").unwrap_or_default());

                let shell = app.shell();
                match shell
                    .command(node_bin.to_str().unwrap())
                    .args([gateway_js.to_str().unwrap()])
                    .env("PATH", &full_path)
                    .env("HOME", std::env::var("HOME").unwrap_or_default())
                    .env("WEB_DIR", web_dir.to_str().unwrap())
                    .env("NO_OPEN", "1")
                    .spawn()
                {
                    Ok((mut rx, child)) => {
                        let pid = child.pid();
                        let state = app.state::<Mutex<GatewayState>>();
                        {
                            let mut guard = state.lock().unwrap();
                            guard.child = Some(child);
                            guard.pid = Some(pid);
                        }

                        tauri::async_runtime::spawn(async move {
                            use tauri_plugin_shell::process::CommandEvent;
                            while let Some(event) = rx.recv().await {
                                match event {
                                    CommandEvent::Stdout(line) => {
                                        println!("[gateway] {}", String::from_utf8_lossy(&line));
                                    }
                                    CommandEvent::Stderr(line) => {
                                        eprintln!("[gateway] {}", String::from_utf8_lossy(&line));
                                    }
                                    CommandEvent::Terminated(status) => {
                                        println!("[gateway] exited: {:?}", status);
                                        break;
                                    }
                                    _ => {}
                                }
                            }
                        });
                    }
                    Err(e) => {
                        eprintln!("[desktop] Failed to spawn gateway sidecar: {}", e);
                    }
                }
            } else {
                println!("[desktop] Dev mode — gateway sidecar skipped. Run `pnpm dev:gateway` separately.");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide to tray instead of quitting
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![])
        .build(tauri::generate_context!())
        .expect("error while building Bit Office")
        .run(|app, event| {
            match event {
                // Re-show window when Dock icon is clicked (macOS)
                tauri::RunEvent::Reopen { .. } => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                // Kill sidecar when app is actually exiting
                tauri::RunEvent::Exit => {
                    kill_gateway(app);
                }
                _ => {}
            }
        });
}
