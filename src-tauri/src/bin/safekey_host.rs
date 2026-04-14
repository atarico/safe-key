/// Safekey Native Messaging Host
///
/// This binary implements the Chrome/Firefox Native Messaging protocol:
/// - Reads messages from stdin: [4-byte LE length][JSON bytes]
/// - Writes messages to stdout: [4-byte LE length][JSON bytes]
///
/// It maintains the vault open in memory for the duration of the browser session.
/// The vault path is read from ~/.config/safekey/config.json (written by the Tauri app).
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::Value;

// We reference the lib crate for shared code
use safekey_lib::{config, vault::VaultManager};

// ─── Global vault state ───────────────────────────────────────────────────────

static VAULT: OnceLock<Mutex<Option<VaultManager>>> = OnceLock::new();

fn vault() -> &'static Mutex<Option<VaultManager>> {
    VAULT.get_or_init(|| Mutex::new(None))
}

// ─── Message types ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum Request {
    /// Check if vault is unlocked
    GetStatus,
    /// Unlock the vault with master password
    Unlock { password: String },
    /// Lock the vault
    Lock,
    /// Find credentials for a hostname
    FindCredentials { hostname: String },
    /// Get the decrypted password for an entry (for auto-fill)
    GetPassword { id: String },
    /// Save a new credential captured from a web form
    SaveCredential {
        site_url: String,
        username: String,
        password: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum Response {
    Ok {
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<Value>,
    },
    Locked {
        message: String,
    },
    Error {
        message: String,
    },
}

impl Response {
    fn ok(data: impl Serialize) -> Self {
        Self::Ok {
            data: Some(serde_json::to_value(data).unwrap_or(Value::Null)),
        }
    }

    fn ok_empty() -> Self {
        Self::Ok { data: None }
    }

    fn locked() -> Self {
        Self::Locked {
            message: "Vault is locked. Open Safekey and unlock it first.".into(),
        }
    }

    fn error(msg: impl std::fmt::Display) -> Self {
        Self::Error {
            message: msg.to_string(),
        }
    }
}

// ─── Native Messaging I/O ─────────────────────────────────────────────────────

/// Reads one Native Messaging message from stdin.
/// Format: [4 bytes LE length][JSON payload]
fn read_message() -> io::Result<Option<Value>> {
    let mut len_buf = [0u8; 4];
    match io::stdin().read_exact(&mut len_buf) {
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }

    let len = u32::from_le_bytes(len_buf) as usize;
    if len == 0 || len > 1_048_576 {
        // Sanity check: max 1 MB message
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("invalid message length: {len}"),
        ));
    }

    let mut buf = vec![0u8; len];
    io::stdin().read_exact(&mut buf)?;

    let value: Value = serde_json::from_slice(&buf)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    Ok(Some(value))
}

/// Writes one Native Messaging message to stdout.
/// Format: [4 bytes LE length][JSON payload]
fn write_message(response: &Response) -> io::Result<()> {
    let json = serde_json::to_vec(response)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    let len = json.len() as u32;
    io::stdout().write_all(&len.to_le_bytes())?;
    io::stdout().write_all(&json)?;
    io::stdout().flush()?;

    Ok(())
}

// ─── Request handlers ─────────────────────────────────────────────────────────

fn handle_get_status() -> Response {
    let locked = vault().lock().unwrap().is_none();
    let vault_configured = config::load().vault_path.is_some();

    #[derive(Serialize)]
    struct Status {
        unlocked: bool,
        vault_configured: bool,
    }

    Response::ok(Status {
        unlocked: !locked,
        vault_configured,
    })
}

fn handle_unlock(password: &str) -> Response {
    let cfg = config::load();
    let Some(vault_path) = cfg.vault_path else {
        return Response::error(
            "No vault configured. Open Safekey and create or open a vault first.",
        );
    };

    let path = PathBuf::from(&vault_path);
    match VaultManager::unlock(&path, password) {
        Ok(manager) => {
            *vault().lock().unwrap() = Some(manager);
            Response::ok_empty()
        }
        Err(e) => Response::error(e),
    }
}

fn handle_lock() -> Response {
    *vault().lock().unwrap() = None;
    Response::ok_empty()
}

fn handle_find_credentials(hostname: &str) -> Response {
    let lock = vault().lock().unwrap();
    match lock.as_ref() {
        None => Response::locked(),
        Some(v) => match v.find_by_hostname(hostname) {
            Ok(entries) => Response::ok(entries),
            Err(e) => Response::error(e),
        },
    }
}

fn handle_get_password(id: &str) -> Response {
    let lock = vault().lock().unwrap();
    match lock.as_ref() {
        None => Response::locked(),
        Some(v) => match v.get_password(id) {
            Ok(pwd) => Response::ok(pwd),
            Err(e) => Response::error(e),
        },
    }
}

fn handle_save_credential(site_url: &str, username: &str, password: &str) -> Response {
    use safekey_lib::vault::entry::EntryInput;

    let lock = vault().lock().unwrap();
    match lock.as_ref() {
        None => Response::locked(),
        Some(v) => {
            let input = EntryInput {
                site_url: site_url.to_string(),
                username: username.to_string(),
                password: password.to_string(),
                notes: None,
            };
            match v.create_entry(input) {
                Ok(entry) => Response::ok(entry),
                Err(e) => Response::error(e),
            }
        }
    }
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

fn dispatch(raw: Value) -> Response {
    let request: Request = match serde_json::from_value(raw) {
        Ok(r) => r,
        Err(e) => return Response::error(format!("invalid request: {e}")),
    };

    match request {
        Request::GetStatus => handle_get_status(),
        Request::Unlock { password } => handle_unlock(&password),
        Request::Lock => handle_lock(),
        Request::FindCredentials { hostname } => handle_find_credentials(&hostname),
        Request::GetPassword { id } => handle_get_password(&id),
        Request::SaveCredential {
            site_url,
            username,
            password,
        } => handle_save_credential(&site_url, &username, &password),
    }
}

// ─── Main loop ────────────────────────────────────────────────────────────────

fn main() {
    loop {
        match read_message() {
            Ok(Some(msg)) => {
                let response = dispatch(msg);
                if write_message(&response).is_err() {
                    break;
                }
            }
            Ok(None) => break, // stdin closed — browser disconnected
            Err(_) => break,
        }
    }
}
