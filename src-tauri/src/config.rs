use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct SafekeyConfig {
    /// Path to the active vault file
    pub vault_path: Option<String>,
}

/// Returns the path to the Safekey config directory.
/// Creates it if it doesn't exist.
pub fn config_dir() -> Option<PathBuf> {
    let dir = dirs::config_dir()?.join("safekey");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// Returns the path to the config file.
pub fn config_path() -> Option<PathBuf> {
    Some(config_dir()?.join("config.json"))
}

/// Loads the config file, returning a default if it doesn't exist.
pub fn load() -> SafekeyConfig {
    let Some(path) = config_path() else {
        return SafekeyConfig::default();
    };
    let Ok(bytes) = std::fs::read(&path) else {
        return SafekeyConfig::default();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

/// Saves the config file.
pub fn save(config: &SafekeyConfig) -> std::io::Result<()> {
    let path = config_path().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "cannot determine config dir")
    })?;
    let json = serde_json::to_vec_pretty(config)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(path, json)
}

/// Persists the vault path so the native host can find it.
pub fn set_vault_path(vault_path: &str) {
    let mut cfg = load();
    cfg.vault_path = Some(vault_path.to_string());
    let _ = save(&cfg);
}
