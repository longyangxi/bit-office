#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    Emitter, Manager,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    menu::{Menu, MenuItem},
};
use tauri_plugin_shell::ShellExt;
use std::sync::Mutex;

#[tauri::command]
fn bounce_dock(window: tauri::Window) {
    let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
}

/// Returns gateway connection info (port + gatewayId) if sidecar is ready, or null.
/// Frontend polls this to handle the race where GATEWAY_READY emits before listen() is registered.
#[tauri::command]
fn get_gateway_info(state: tauri::State<'_, Mutex<GatewayInfo>>) -> Option<serde_json::Value> {
    state.lock().unwrap().ready_payload.clone()
}

struct GatewayState {
    child: Option<tauri_plugin_shell::process::CommandChild>,
    pid: Option<u32>,
}

struct GatewayInfo {
    ready_payload: Option<serde_json::Value>,
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
        .plugin(tauri_plugin_notification::init())
        .manage(Mutex::new(GatewayState { child: None, pid: None }))
        .manage(Mutex::new(GatewayInfo { ready_payload: None }))
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

                // Resolve user's full PATH — GUI apps inherit a minimal PATH
                // macOS: get PATH from login shell, then append well-known CLI tool dirs
                // that may only be added in .zshrc (not sourced by non-interactive login shells)
                // Windows/Linux: inherit from environment (usually sufficient)
                let full_path = if cfg!(target_os = "macos") {
                    let resolve_path = |shell: &str| -> Option<String> {
                        std::process::Command::new(shell)
                            .args(["-l", "-c", "printenv PATH"])
                            .output()
                            .ok()
                            .and_then(|o| if o.status.success() { String::from_utf8(o.stdout).ok() } else { None })
                            .and_then(|p| p.lines().rev().find(|l| !l.trim().is_empty()).map(|l| l.trim().to_string()))
                            .filter(|p| !p.is_empty())
                    };
                    let mut base = resolve_path("/bin/zsh")
                        .or_else(|| resolve_path("/bin/bash"))
                        .unwrap_or_else(|| std::env::var("PATH").unwrap_or_default());

                    // Append common CLI tool paths that .zshrc might add but login shell misses
                    let home = std::env::var("HOME").unwrap_or_default();
                    // Detect NVM's current node bin directory (NVM is loaded in .bashrc, not login shell)
                    let nvm_bin = std::fs::read_to_string(format!("{}/.nvm/alias/default", home))
                        .ok()
                        .filter(|s| !s.trim().is_empty())
                        .and_then(|alias| {
                            let v = alias.trim().to_string();
                            // Resolve alias like "22" → find matching version dir
                            let versions_dir = format!("{}/.nvm/versions/node", home);
                            if let Ok(entries) = std::fs::read_dir(&versions_dir) {
                                let mut matches: Vec<String> = entries
                                    .filter_map(|e| e.ok())
                                    .map(|e| e.file_name().to_string_lossy().to_string())
                                    .filter(|name| name.starts_with(&format!("v{}", v)) || name == &format!("v{}", v))
                                    .collect();
                                matches.sort();
                                matches.last().map(|m| format!("{}/{}/bin", versions_dir, m))
                            } else {
                                None
                            }
                        })
                        .or_else(|| {
                            // Fallback: pick the latest installed version
                            let versions_dir = format!("{}/.nvm/versions/node", home);
                            std::fs::read_dir(&versions_dir).ok().and_then(|entries| {
                                let mut versions: Vec<String> = entries
                                    .filter_map(|e| e.ok())
                                    .map(|e| e.file_name().to_string_lossy().to_string())
                                    .filter(|n| n.starts_with('v'))
                                    .collect();
                                versions.sort();
                                versions.last().map(|v| format!("{}/{}/bin", versions_dir, v))
                            })
                        });

                    let mut extra_paths = vec![
                        format!("{}/.local/bin", home),         // claude, pip, pipx
                        format!("{}/.local/share/pnpm", home),  // pnpm global
                        format!("{}/.cargo/bin", home),         // rust/cargo
                        "/opt/homebrew/bin".to_string(),        // homebrew (arm64)
                        "/usr/local/bin".to_string(),           // homebrew (x86)
                    ];
                    if let Some(nvm_path) = nvm_bin {
                        println!("[desktop] NVM node bin: {}", nvm_path);
                        extra_paths.insert(0, nvm_path);        // NVM node/npm/npx
                    }
                    for p in &extra_paths {
                        if !base.split(':').any(|e| e == p) && std::path::Path::new(p).is_dir() {
                            base.push(':');
                            base.push_str(p);
                        }
                    }
                    base
                } else {
                    std::env::var("PATH").unwrap_or_default()
                };

                let shell = app.shell();
                match shell
                    .command(node_bin.to_str().unwrap())
                    .args([gateway_js.to_str().unwrap()])
                    .env("PATH", &full_path)
                    .env("HOME", std::env::var("HOME").unwrap_or_default())
                    .env("WEB_DIR", web_dir.to_str().unwrap())
                    .env("NO_OPEN", "1")
                    .env("GATEWAY_ID", "desktop")
                    .env("NODE_ENV", "production")
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

                        let app_handle = app.handle().clone();
                        tauri::async_runtime::spawn(async move {
                            use tauri_plugin_shell::process::CommandEvent;
                            while let Some(event) = rx.recv().await {
                                match event {
                                    CommandEvent::Stdout(line) => {
                                        let text = String::from_utf8_lossy(&line);
                                        println!("[gateway] {}", text);

                                        // Parse GATEWAY_READY signal, store it, and emit to webview
                                        if let Some(json_str) = text.strip_prefix("GATEWAY_READY ") {
                                            if let Ok(value) = serde_json::from_str::<serde_json::Value>(json_str.trim()) {
                                                println!("[desktop] Gateway ready: {}", value);
                                                // Store for get_gateway_info command (handles race where
                                                // webview hasn't registered listen() yet)
                                                let info_state = app_handle.state::<Mutex<GatewayInfo>>();
                                                info_state.lock().unwrap().ready_payload = Some(value.clone());
                                                // Also emit event for listen()-based path
                                                let _ = app_handle.emit("gateway-ready", value);
                                            }
                                        }
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
        .invoke_handler(tauri::generate_handler![bounce_dock, get_gateway_info])
        .build(tauri::generate_context!())
        .expect("error while building Open Office")
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
