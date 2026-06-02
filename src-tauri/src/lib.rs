// SocketMan Tauri entrypoint.
//
// Phase 1 ships a near-empty backend: it only opens the window and renders the
// React UI driven by the mock transport. The real transport (WebSocket + HTTP)
// commands are registered here in later phases via `generate_handler!`
// (one handler per line, alphabetized) once the `ws/` and `http/` modules land.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // .invoke_handler(tauri::generate_handler![/* commands appended in Phase 2+ */])
        .run(tauri::generate_context!())
        .expect("error while running SocketMan");
}
