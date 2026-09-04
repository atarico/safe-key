use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

use crate::{
    config,
    error::SafekeyError,
    vault::{Entry, VaultManager, entry::EntryInput},
};

/// Global vault state — protected by a Mutex so Tauri can share it across commands.
pub struct VaultState(pub Mutex<Option<VaultManager>>);

// ─── Vault lifecycle ──────────────────────────────────────────────────────────

/// Creates a new vault at the given path.
#[tauri::command]
pub fn create_vault(
    vault_path: String,
    master_password: String,
    state: State<'_, VaultState>,
) -> Result<(), SafekeyError> {
    let path = PathBuf::from(&vault_path);

    if path.exists() {
        return Err(SafekeyError::InvalidInput(
            "A vault already exists at this path".into(),
        ));
    }

    let manager = VaultManager::create_with_salt_file(&path, &master_password)?;
    *state.0.lock().unwrap() = Some(manager);
    config::set_vault_path(&vault_path);
    Ok(())
}

/// Unlocks an existing vault.
#[tauri::command]
pub fn unlock_vault(
    vault_path: String,
    master_password: String,
    state: State<'_, VaultState>,
) -> Result<(), SafekeyError> {
    let path = PathBuf::from(&vault_path);
    let manager = VaultManager::unlock(&path, &master_password)?;
    *state.0.lock().unwrap() = Some(manager);
    config::set_vault_path(&vault_path);
    Ok(())
}

/// Locks the vault (drops the VaultManager, which zeroizes the master key).
#[tauri::command]
pub fn lock_vault(state: State<'_, VaultState>) {
    *state.0.lock().unwrap() = None;
}

/// Returns true if the vault is currently unlocked.
#[tauri::command]
pub fn is_vault_unlocked(state: State<'_, VaultState>) -> bool {
    state.0.lock().unwrap().is_some()
}

/// Returns the last vault path persisted in config.json, if any.
/// Used to prefill the unlock screen so the user doesn't retype it every time.
#[tauri::command]
pub fn get_last_vault_path() -> Option<String> {
    config::last_vault_path()
}

// ─── Entries ──────────────────────────────────────────────────────────────────

/// Returns all entries (without passwords).
#[tauri::command]
pub fn list_entries(state: State<'_, VaultState>) -> Result<Vec<Entry>, SafekeyError> {
    with_vault(&state, |vault| vault.list_entries())
}

/// Creates a new entry.
#[tauri::command]
pub fn create_entry(
    input: EntryInput,
    state: State<'_, VaultState>,
) -> Result<Entry, SafekeyError> {
    with_vault(&state, |vault| vault.create_entry(input))
}

/// Updates an existing entry.
#[tauri::command]
pub fn update_entry(
    id: String,
    input: EntryInput,
    state: State<'_, VaultState>,
) -> Result<Entry, SafekeyError> {
    with_vault(&state, |vault| vault.update_entry(&id, input))
}

/// Deletes an entry.
#[tauri::command]
pub fn delete_entry(id: String, state: State<'_, VaultState>) -> Result<(), SafekeyError> {
    with_vault(&state, |vault| vault.delete_entry(&id))
}

/// Returns the decrypted password for a specific entry.
/// Used for clipboard copy and auto-fill only.
#[tauri::command]
pub fn get_entry_password(id: String, state: State<'_, VaultState>) -> Result<String, SafekeyError> {
    with_vault(&state, |vault| vault.get_password(&id))
}

/// Finds entries matching a hostname (for browser extension auto-fill).
#[tauri::command]
pub fn find_by_hostname(
    hostname: String,
    state: State<'_, VaultState>,
) -> Result<Vec<Entry>, SafekeyError> {
    with_vault(&state, |vault| vault.find_by_hostname(&hostname))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn with_vault<F, T>(state: &State<'_, VaultState>, f: F) -> Result<T, SafekeyError>
where
    F: FnOnce(&VaultManager) -> Result<T, SafekeyError>,
{
    let lock = state.0.lock().unwrap();
    match lock.as_ref() {
        Some(vault) => f(vault),
        None => Err(SafekeyError::VaultLocked),
    }
}
