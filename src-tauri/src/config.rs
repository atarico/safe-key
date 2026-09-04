use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

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
    match config_path() {
        Some(path) => load_from(&path),
        None => SafekeyConfig::default(),
    }
}

/// Loads a config file from an explicit path.
/// Missing or corrupted files yield a default config instead of an error.
pub fn load_from(path: &Path) -> SafekeyConfig {
    let Ok(bytes) = std::fs::read(path) else {
        return SafekeyConfig::default();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

/// Saves the config file.
pub fn save(config: &SafekeyConfig) -> std::io::Result<()> {
    let path = config_path().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "cannot determine config dir")
    })?;
    save_to(&path, config)
}

/// Saves a config file to an explicit path.
pub fn save_to(path: &Path, config: &SafekeyConfig) -> std::io::Result<()> {
    let json = serde_json::to_vec_pretty(config)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(path, json)
}

/// Returns the last vault path persisted in the config, if any.
pub fn last_vault_path() -> Option<String> {
    load().vault_path
}

/// Persists the vault path so the native host can find it.
pub fn set_vault_path(vault_path: &str) {
    let mut cfg = load();
    cfg.vault_path = Some(vault_path.to_string());
    let _ = save(&cfg);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Creates an isolated temp directory so tests never touch the real user config.
    fn temp_config_path() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("safekey-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir.join("config.json")
    }

    fn cleanup(path: &Path) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    #[test]
    fn load_from_missing_file_returns_default() {
        let path = temp_config_path();

        let cfg = load_from(&path);

        assert!(cfg.vault_path.is_none());
        cleanup(&path);
    }

    #[test]
    fn save_to_then_load_from_round_trips_vault_path() {
        let path = temp_config_path();
        let cfg = SafekeyConfig {
            vault_path: Some("/home/user/Dropbox/safekey.db".into()),
        };

        save_to(&path, &cfg).expect("save config");
        let loaded = load_from(&path);

        assert_eq!(loaded.vault_path.as_deref(), Some("/home/user/Dropbox/safekey.db"));
        cleanup(&path);
    }

    #[test]
    fn load_from_corrupted_file_returns_default() {
        let path = temp_config_path();
        std::fs::write(&path, b"{ not valid json").expect("write corrupted file");

        let cfg = load_from(&path);

        assert!(cfg.vault_path.is_none());
        cleanup(&path);
    }
}
