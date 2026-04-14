use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use argon2::{Argon2, Params, Version};
use rand::RngCore;
use secrecy::{ExposeSecret, SecretVec};
use zeroize::Zeroize;

use crate::error::SafekeyError;

/// Salt size for Argon2id (16 bytes)
pub const SALT_SIZE: usize = 16;
/// Nonce size for AES-256-GCM (12 bytes)
const NONCE_SIZE: usize = 12;
/// Key size for AES-256-GCM (32 bytes = 256 bits)
const KEY_SIZE: usize = 32;

/// Argon2id parameters — OWASP recommended minimums
const ARGON2_MEMORY_KB: u32 = 65536; // 64 MB
const ARGON2_ITERATIONS: u32 = 3;
const ARGON2_PARALLELISM: u32 = 4;

/// Derives a 32-byte key from a master password using Argon2id.
///
/// The salt must be stored alongside the vault (it's not secret).
/// The returned key is wrapped in SecretVec so it gets zeroized on drop.
pub fn derive_key(password: &str, salt: &[u8; SALT_SIZE]) -> Result<SecretVec<u8>, SafekeyError> {
    let params = Params::new(
        ARGON2_MEMORY_KB,
        ARGON2_ITERATIONS,
        ARGON2_PARALLELISM,
        Some(KEY_SIZE),
    )
    .map_err(|e| SafekeyError::Crypto(e.to_string()))?;

    let argon2 = Argon2::new(argon2::Algorithm::Argon2id, Version::V0x13, params);

    let mut key_bytes = vec![0u8; KEY_SIZE];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key_bytes)
        .map_err(|e| SafekeyError::Crypto(e.to_string()))?;

    Ok(SecretVec::new(key_bytes))
}

/// Generates a cryptographically random salt for Argon2id.
pub fn generate_salt() -> [u8; SALT_SIZE] {
    let mut salt = [0u8; SALT_SIZE];
    OsRng.fill_bytes(&mut salt);
    salt
}

/// Encrypts plaintext using AES-256-GCM.
///
/// Returns `nonce || ciphertext` as a single Vec<u8>.
/// The nonce is prepended so it can be extracted on decryption.
pub fn encrypt(key: &SecretVec<u8>, plaintext: &[u8]) -> Result<Vec<u8>, SafekeyError> {
    let key_bytes = key.expose_secret();
    let cipher_key = Key::<Aes256Gcm>::from_slice(key_bytes);
    let cipher = Aes256Gcm::new(cipher_key);

    let mut nonce_bytes = [0u8; NONCE_SIZE];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| SafekeyError::Crypto(e.to_string()))?;

    // Prepend nonce to ciphertext: [nonce (12 bytes)] [ciphertext]
    let mut result = Vec::with_capacity(NONCE_SIZE + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);

    Ok(result)
}

/// Decrypts data produced by `encrypt`.
///
/// Expects input as `nonce || ciphertext`.
/// Returns plaintext as a Vec<u8> that is zeroized on drop.
pub fn decrypt(key: &SecretVec<u8>, data: &[u8]) -> Result<ZeroizedBytes, SafekeyError> {
    if data.len() < NONCE_SIZE {
        return Err(SafekeyError::Crypto("data too short to contain nonce".into()));
    }

    let (nonce_bytes, ciphertext) = data.split_at(NONCE_SIZE);
    let key_bytes = key.expose_secret();
    let cipher_key = Key::<Aes256Gcm>::from_slice(key_bytes);
    let cipher = Aes256Gcm::new(cipher_key);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| SafekeyError::DecryptionFailed)?;

    Ok(ZeroizedBytes(plaintext))
}

/// A Vec<u8> that is securely zeroized when dropped.
pub struct ZeroizedBytes(Vec<u8>);

impl ZeroizedBytes {
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    pub fn to_string_lossy(&self) -> String {
        String::from_utf8_lossy(&self.0).into_owned()
    }
}

impl Drop for ZeroizedBytes {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let salt = generate_salt();
        let key = derive_key("test-password-123", &salt).unwrap();
        let plaintext = b"super secret password";

        let ciphertext = encrypt(&key, plaintext).unwrap();
        let decrypted = decrypt(&key, &ciphertext).unwrap();

        assert_eq!(decrypted.as_bytes(), plaintext);
    }

    #[test]
    fn test_wrong_key_fails_decryption() {
        let salt = generate_salt();
        let key = derive_key("correct-password", &salt).unwrap();
        let wrong_key = derive_key("wrong-password", &salt).unwrap();

        let ciphertext = encrypt(&key, b"secret").unwrap();
        let result = decrypt(&wrong_key, &ciphertext);

        assert!(result.is_err());
    }

    #[test]
    fn test_unique_nonces() {
        let salt = generate_salt();
        let key = derive_key("password", &salt).unwrap();
        let plaintext = b"same plaintext";

        let c1 = encrypt(&key, plaintext).unwrap();
        let c2 = encrypt(&key, plaintext).unwrap();

        // Different nonces → different ciphertext even for same plaintext
        assert_ne!(c1, c2);
    }
}
