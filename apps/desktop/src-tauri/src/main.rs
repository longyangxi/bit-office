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
}

fn main() {
    let is_dev = cfg!(debug_assertions);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .manage(Mutex::new(GatewayState { child: None }))
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
                    "quit" => app.exit(0),
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
            // In dev mode, run gateway separately via `pnpm dev:gateway`
            if !is_dev {
                let resource_dir = app
                    .path()
                    .resource_dir()
                    .expect("failed to resolve resource dir");
                let sidecar_dir = resource_dir.join("sidecar");
                let node_bin = sidecar_dir.join("node");
                let gateway_js = sidecar_dir.join("gateway.js");
                let web_dir = sidecar_dir.join("web");

                let shell = app.shell();
                match shell
                    .command(node_bin.to_str().unwrap())
                    .args([gateway_js.to_str().unwrap()])
                    .env("WEB_DIR", web_dir.to_str().unwrap())
                    .spawn()
                {
                    Ok((mut rx, child)) => {
                        app.state::<Mutex<GatewayState>>()
                            .lock()
                            .unwrap()
                            .child = Some(child);

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
        .run(tauri::generate_context!())
        .expect("error while running Bit Office");
}
