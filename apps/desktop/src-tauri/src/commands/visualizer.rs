#[tauri::command]
pub fn visualizer_start(
    state: tauri::State<'_, crate::state::AppState>,
    app_handle: tauri::AppHandle,
    source_path: String,
    start_position: f64,
) -> Result<(), String> {
    // Stoppe une capture précédente s'il y en a une
    if let Some(prev) = state.visualizer.lock().unwrap().take() {
        services::visualizer::stop_capture(&prev);
    }
    let handle = services::visualizer::start_capture(app_handle, source_path, start_position)?;
    *state.visualizer.lock().unwrap() = Some(handle);
    Ok(())
}

#[tauri::command]
pub fn visualizer_stop(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    if let Some(handle) = state.visualizer.lock().unwrap().take() {
        services::visualizer::stop_capture(&handle);
    }
    Ok(())
}