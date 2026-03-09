use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

struct AppState {
    file_path: Mutex<Option<String>>,
}

fn config_dir() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("budget-app")
}

fn config_file() -> PathBuf {
    config_dir().join("config.json")
}

fn read_config() -> Option<String> {
    let path = config_file();
    let content = fs::read_to_string(path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;
    parsed.get("last_file")?.as_str().map(String::from)
}

fn write_config(file_path: &str) {
    let dir = config_dir();
    fs::create_dir_all(&dir).ok();
    let config = serde_json::json!({ "last_file": file_path });
    fs::write(config_file(), serde_json::to_string_pretty(&config).unwrap()).ok();
}

#[tauri::command]
fn get_last_file_path(state: State<'_, AppState>) -> Option<String> {
    let guard = state.file_path.lock().unwrap();
    guard.clone()
}

#[tauri::command]
fn set_file_path(path: String, state: State<'_, AppState>) {
    write_config(&path);
    let mut guard = state.file_path.lock().unwrap();
    *guard = Some(path);
}

#[tauri::command]
fn load_data(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_data(path: String, data: String) -> Result<(), String> {
    fs::write(&path, &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let last_path = read_config();

    tauri::Builder::default()
        .manage(AppState {
            file_path: Mutex::new(last_path),
        })
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_last_file_path,
            set_file_path,
            load_data,
            save_data,
            file_exists,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
