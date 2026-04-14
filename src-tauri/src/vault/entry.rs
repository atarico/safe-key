use serde::{Deserialize, Serialize};

/// A vault entry as returned to the frontend.
/// The password is NEVER sent to the frontend in plain form — only on explicit copy/autofill.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub site_url: String,
    pub username: String,
    /// Password is omitted from list responses for security.
    /// Use `get_entry_password` command to retrieve it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    pub notes: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Input for creating or updating an entry.
#[derive(Debug, Deserialize)]
pub struct EntryInput {
    pub site_url: String,
    pub username: String,
    pub password: String,
    pub notes: Option<String>,
}

impl EntryInput {
    pub fn validate(&self) -> Result<(), String> {
        if self.site_url.trim().is_empty() {
            return Err("site_url cannot be empty".into());
        }
        if self.username.trim().is_empty() {
            return Err("username cannot be empty".into());
        }
        if self.password.is_empty() {
            return Err("password cannot be empty".into());
        }
        Ok(())
    }

    /// Normalizes the site_url to just the hostname (strips scheme, path, trailing slash).
    pub fn normalized_url(&self) -> String {
        let url = self.site_url.trim();
        // Strip scheme
        let url = url
            .strip_prefix("https://")
            .or_else(|| url.strip_prefix("http://"))
            .unwrap_or(url);
        // Strip path (keep only host)
        let url = url.split('/').next().unwrap_or(url);
        // Strip port
        let url = url.split(':').next().unwrap_or(url);
        url.to_lowercase()
    }
}
