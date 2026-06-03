// SocketMan Tauri entrypoint.
//
// Registers the WS transport: managed `WsManager` state + the connect/disconnect/send
// commands. On window-destroy every connection sender is dropped so the spawned
// socket tasks exit (tasks are not auto-cancelled on close — they must be torn down).

mod commands;
pub mod error;
pub mod http;
pub mod storage;
pub mod ws;

use http::client::HttpClient;
use storage::StorageManager;
use tauri::Manager;
use ws::manager::WsManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(WsManager::default())
        .manage(HttpClient::new().expect("failed to build HTTP client"))
        .setup(|app| {
            // App data dir holds collections/environments/history JSON. Created on
            // first write; the StorageManager owns the per-file write locks.
            let dir = app.path().app_data_dir().expect("no app data dir");
            app.manage(StorageManager::new(dir));
            Ok(())
        })
        // Handlers alphabetized, one per line. (secret_get is NEVER registered — S3.)
        .invoke_handler(tauri::generate_handler![
            commands::export_write,
            commands::history_append,
            commands::http_send,
            commands::secret_delete,
            commands::secret_set,
            commands::storage_load,
            commands::storage_save,
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
