// SocketMan Tauri entrypoint.
//
// Registers the WS transport: managed `WsManager` state + the connect/disconnect/send
// commands. On window-destroy every connection sender is dropped so the spawned
// socket tasks exit (tasks are not auto-cancelled on close — they must be torn down).

mod commands;
pub mod error;
pub mod ws;

use tauri::Manager;
use ws::manager::WsManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WsManager::default())
        // Handlers alphabetized, one per line.
        .invoke_handler(tauri::generate_handler![
            commands::ws_connect,
            commands::ws_disconnect,
            commands::ws_send,
        ])
        .build(tauri::generate_context!())
        .expect("error while building SocketMan")
        .run(|app, event| {
            if let tauri::RunEvent::WindowEvent { event: tauri::WindowEvent::Destroyed, .. } = event {
                app.state::<WsManager>().shutdown_all();
            }
        });
}
