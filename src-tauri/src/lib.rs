mod commands;
mod crypto;
mod db;
mod error;
mod vault;

use commands::VaultState;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(VaultState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            commands::create_vault,
            commands::unlock_vault,
            commands::lock_vault,
            commands::is_vault_unlocked,
            commands::list_entries,
            commands::create_entry,
            commands::update_entry,
            commands::delete_entry,
            commands::get_entry_password,
            commands::find_by_hostname,
        ])
        .run(tauri::generate_context!())
        .expect("error while running safekey");
}
