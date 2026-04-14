use thiserror::Error;

#[derive(Debug, Error)]
pub enum SafekeyError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Cryptographic error: {0}")]
    Crypto(String),

    #[error("Decryption failed — wrong master password or corrupted data")]
    DecryptionFailed,

    #[error("Vault is locked — unlock with your master password first")]
    VaultLocked,

    #[error("Entry not found: {0}")]
    NotFound(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

// Tauri commands require errors to implement serde::Serialize
impl serde::Serialize for SafekeyError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
