use rusqlite::{Connection, params};
use secrecy::{ExposeSecret, SecretVec};
use std::path::Path;

use crate::error::SafekeyError;

/// Opens (or creates) an SQLCipher-encrypted database at the given path.
///
/// The master key is used to unlock the database via SQLCipher's PRAGMA key.
/// If the database is new, it will be created and initialized with the schema.
pub fn open(path: &Path, master_key: &SecretVec<u8>) -> Result<Connection, SafekeyError> {
    let conn = Connection::open(path)?;

    // Derive a hex key string for SQLCipher PRAGMA
    // SQLCipher accepts raw key as: PRAGMA key = "x'<hex>'"
    let key_hex = hex_encode(master_key.expose_secret());
    conn.execute_batch(&format!("PRAGMA key = \"x'{key_hex}'\";"))?;

    // Verify the key is correct by trying to read the schema
    conn.execute_batch("SELECT count(*) FROM sqlite_master;")?;

    // Set recommended SQLCipher settings
    conn.execute_batch(
        "PRAGMA cipher_page_size = 4096;
         PRAGMA kdf_iter = 256000;
         PRAGMA cipher_hmac_algorithm = HMAC_SHA512;
         PRAGMA cipher_kdf_algorithm = PBKDF2_HMAC_SHA512;
         PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;",
    )?;

    run_migrations(&conn)?;

    Ok(conn)
}

/// Runs database migrations in order.
/// Safe to call on an already-migrated database.
fn run_migrations(conn: &Connection) -> Result<(), SafekeyError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version     INTEGER PRIMARY KEY,
            applied_at  INTEGER NOT NULL DEFAULT (unixepoch())
        );",
    )?;

    // Migration 001 — initial schema
    let applied: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM schema_migrations WHERE version = 1",
        [],
        |row| row.get(0),
    )?;

    if !applied {
        conn.execute_batch(
            "CREATE TABLE entries (
                id          TEXT PRIMARY KEY NOT NULL,
                site_url    TEXT NOT NULL,
                username    TEXT NOT NULL,
                password    BLOB NOT NULL,
                notes       BLOB,
                created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
                updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
            );

            CREATE INDEX idx_entries_site_url ON entries(site_url);

            CREATE TABLE settings (
                key     TEXT PRIMARY KEY NOT NULL,
                value   TEXT NOT NULL
            );

            -- Store the Argon2id salt used to derive the SQLCipher key
            -- (salt is NOT secret — it's needed to re-derive the key on next unlock)
            CREATE TABLE vault_meta (
                key     TEXT PRIMARY KEY NOT NULL,
                value   BLOB NOT NULL
            );

            INSERT INTO schema_migrations (version) VALUES (1);",
        )?;
    }

    Ok(())
}

/// Encodes bytes as a lowercase hex string.
fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Verifies that a connection can read the database (key is correct).
pub fn verify_key(conn: &Connection) -> Result<(), SafekeyError> {
    conn.execute_batch("SELECT count(*) FROM sqlite_master;")
        .map_err(|_| SafekeyError::DecryptionFailed)
}

/// Stores the Argon2id salt in the vault metadata table.
pub fn store_salt(conn: &Connection, salt: &[u8]) -> Result<(), SafekeyError> {
    conn.execute(
        "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('argon2_salt', ?1)",
        params![salt],
    )?;
    Ok(())
}

/// Retrieves the Argon2id salt from the vault metadata table.
pub fn load_salt(conn: &Connection) -> Result<Vec<u8>, SafekeyError> {
    let salt: Vec<u8> = conn.query_row(
        "SELECT value FROM vault_meta WHERE key = 'argon2_salt'",
        [],
        |row| row.get(0),
    )?;
    Ok(salt)
}
