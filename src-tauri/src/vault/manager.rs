use rusqlite::params;
use secrecy::SecretVec;
use std::path::{Path, PathBuf};
use uuid::Uuid;

use crate::{
    crypto,
    db,
    error::SafekeyError,
    vault::entry::{Entry, EntryInput},
};

/// VaultManager owns the database connection and the in-memory master key.
///
/// The master key is held as a SecretVec<u8> — it gets zeroized when this struct is dropped.
/// The vault must be explicitly unlocked before any CRUD operations.
pub struct VaultManager {
    conn: rusqlite::Connection,
    master_key: SecretVec<u8>,
    vault_path: PathBuf,
}

impl VaultManager {
    /// Creates a new vault at the given path with the given master password.
    ///
    /// Generates a fresh Argon2id salt, derives the master key, creates the SQLCipher DB.
    pub fn create(vault_path: &Path, master_password: &str) -> Result<Self, SafekeyError> {
        let salt = crypto::generate_salt();
        let master_key = crypto::derive_key(master_password, &salt)?;
        let conn = db::open(vault_path, &master_key)?;

        // Store the salt so we can re-derive the key on future unlocks
        db::store_salt(&conn, &salt)?;

        Ok(Self {
            conn,
            master_key,
            vault_path: vault_path.to_path_buf(),
        })
    }

    /// Opens an existing vault at the given path.
    ///
    /// Loads the stored Argon2id salt, derives the master key, opens the SQLCipher DB.
    /// Returns DecryptionFailed if the password is wrong.
    pub fn unlock(vault_path: &Path, master_password: &str) -> Result<Self, SafekeyError> {
        // We need to open with a temporary approach:
        // Load the salt from a separate metadata file, or bootstrap from the DB.
        //
        // Since the salt is stored INSIDE the encrypted DB, we need the correct key to read it.
        // Strategy: derive the key from the password + a candidate salt, try to open the DB.
        // The salt is stored in vault_meta table — we just need to get it first.
        //
        // We store the salt in a companion .salt file alongside vault.db for bootstrapping.
        let salt_path = vault_path.with_extension("salt");
        let salt_bytes = std::fs::read(&salt_path)
            .map_err(|_| SafekeyError::NotFound("Vault salt file not found. Is this a valid Safekey vault?".into()))?;

        if salt_bytes.len() != crypto::SALT_SIZE {
            return Err(SafekeyError::Crypto("Invalid salt size".into()));
        }

        let mut salt = [0u8; crypto::SALT_SIZE];
        salt.copy_from_slice(&salt_bytes);

        let master_key = crypto::derive_key(master_password, &salt)?;

        // Try to open the database — this verifies the key is correct
        let conn = db::open(vault_path, &master_key)?;

        Ok(Self {
            conn,
            master_key,
            vault_path: vault_path.to_path_buf(),
        })
    }

    /// Creates a new vault AND writes the companion .salt file.
    pub fn create_with_salt_file(vault_path: &Path, master_password: &str) -> Result<Self, SafekeyError> {
        let salt = crypto::generate_salt();
        let master_key = crypto::derive_key(master_password, &salt)?;
        let conn = db::open(vault_path, &master_key)?;

        db::store_salt(&conn, &salt)?;

        // Write companion .salt file for bootstrapping future unlocks
        let salt_path = vault_path.with_extension("salt");
        std::fs::write(&salt_path, &salt)?;

        Ok(Self {
            conn,
            master_key,
            vault_path: vault_path.to_path_buf(),
        })
    }

    /// Returns the path to the vault file.
    pub fn path(&self) -> &Path {
        &self.vault_path
    }

    // ─── CRUD ────────────────────────────────────────────────────────────────

    /// Creates a new entry in the vault.
    pub fn create_entry(&self, input: EntryInput) -> Result<Entry, SafekeyError> {
        input.validate().map_err(SafekeyError::InvalidInput)?;

        let id = Uuid::new_v4().to_string();
        let site_url = input.normalized_url();
        let now = unix_now();

        let password_enc = crypto::encrypt(&self.master_key, input.password.as_bytes())?;
        let notes_enc = input
            .notes
            .as_deref()
            .map(|n| crypto::encrypt(&self.master_key, n.as_bytes()))
            .transpose()?;

        self.conn.execute(
            "INSERT INTO entries (id, site_url, username, password, notes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, site_url, input.username, password_enc, notes_enc, now, now],
        )?;

        Ok(Entry {
            id,
            site_url,
            username: input.username,
            password: None,
            notes: input.notes,
            created_at: now,
            updated_at: now,
        })
    }

    /// Returns all entries (without passwords).
    pub fn list_entries(&self) -> Result<Vec<Entry>, SafekeyError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, site_url, username, notes, created_at, updated_at
             FROM entries ORDER BY site_url ASC",
        )?;

        let entries = stmt.query_map([], |row| {
            let notes_enc: Option<Vec<u8>> = row.get(3)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                notes_enc,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })?;

        let mut result = Vec::new();
        for entry in entries {
            let (id, site_url, username, notes_enc, created_at, updated_at) = entry?;

            let notes = notes_enc
                .as_deref()
                .map(|enc| {
                    crypto::decrypt(&self.master_key, enc)
                        .map(|b| b.to_string_lossy())
                })
                .transpose()?;

            result.push(Entry {
                id,
                site_url,
                username,
                password: None,
                notes,
                created_at,
                updated_at,
            });
        }

        Ok(result)
    }

    /// Searches entries by hostname (for auto-fill).
    pub fn find_by_hostname(&self, hostname: &str) -> Result<Vec<Entry>, SafekeyError> {
        let normalized = hostname.to_lowercase();
        let pattern = format!("%{normalized}%");

        let mut stmt = self.conn.prepare(
            "SELECT id, site_url, username, notes, created_at, updated_at
             FROM entries WHERE site_url LIKE ?1 ORDER BY updated_at DESC",
        )?;

        let entries = stmt.query_map(params![pattern], |row| {
            let notes_enc: Option<Vec<u8>> = row.get(3)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                notes_enc,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })?;

        let mut result = Vec::new();
        for entry in entries {
            let (id, site_url, username, notes_enc, created_at, updated_at) = entry?;

            let notes = notes_enc
                .as_deref()
                .map(|enc| {
                    crypto::decrypt(&self.master_key, enc)
                        .map(|b| b.to_string_lossy())
                })
                .transpose()?;

            result.push(Entry {
                id,
                site_url,
                username,
                password: None,
                notes,
                created_at,
                updated_at,
            });
        }

        Ok(result)
    }

    /// Returns the decrypted password for an entry (for copy/auto-fill only).
    pub fn get_password(&self, entry_id: &str) -> Result<String, SafekeyError> {
        let password_enc: Vec<u8> = self.conn.query_row(
            "SELECT password FROM entries WHERE id = ?1",
            params![entry_id],
            |row| row.get(0),
        )?;

        let decrypted = crypto::decrypt(&self.master_key, &password_enc)?;
        Ok(decrypted.to_string_lossy())
    }

    /// Updates an existing entry.
    pub fn update_entry(&self, id: &str, input: EntryInput) -> Result<Entry, SafekeyError> {
        input.validate().map_err(SafekeyError::InvalidInput)?;

        // Verify entry exists
        let exists: bool = self.conn.query_row(
            "SELECT COUNT(*) > 0 FROM entries WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;

        if !exists {
            return Err(SafekeyError::NotFound(id.to_string()));
        }

        let site_url = input.normalized_url();
        let now = unix_now();
        let password_enc = crypto::encrypt(&self.master_key, input.password.as_bytes())?;
        let notes_enc = input
            .notes
            .as_deref()
            .map(|n| crypto::encrypt(&self.master_key, n.as_bytes()))
            .transpose()?;

        self.conn.execute(
            "UPDATE entries SET site_url = ?1, username = ?2, password = ?3, notes = ?4, updated_at = ?5
             WHERE id = ?6",
            params![site_url, input.username, password_enc, notes_enc, now, id],
        )?;

        let created_at: i64 = self.conn.query_row(
            "SELECT created_at FROM entries WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;

        Ok(Entry {
            id: id.to_string(),
            site_url,
            username: input.username,
            password: None,
            notes: input.notes,
            created_at,
            updated_at: now,
        })
    }

    /// Deletes an entry.
    pub fn delete_entry(&self, id: &str) -> Result<(), SafekeyError> {
        let affected = self.conn.execute(
            "DELETE FROM entries WHERE id = ?1",
            params![id],
        )?;

        if affected == 0 {
            return Err(SafekeyError::NotFound(id.to_string()));
        }

        Ok(())
    }
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
