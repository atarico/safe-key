# Safekey

Source-available, local-first password manager. Your vault is a single encrypted file on your disk. Nothing is sent anywhere, there are no accounts and no telemetry. A desktop app manages the vault and a browser extension auto-fills and captures credentials through a native messaging bridge.

> **Status:** alpha (0.1.0). Developed and tested on Linux (Ubuntu 24.04). The native host installer currently targets Linux paths only.

## How it works

```
┌──────────────┐      Tauri IPC       ┌──────────────────────┐
│  Desktop app │ ◄──────────────────► │  Rust core           │
│  (React)     │                      │  crypto · db · vault │
└──────────────┘                      └──────────┬───────────┘
                                                 │ SQLCipher
                                                 ▼
                                        ~/path/to/vault.db  (+ vault.salt)
                                                 ▲
                                                 │
┌──────────────┐   Native Messaging   ┌──────────┴───────────┐
│  Extension   │ ◄──────────────────► │  safekey-host        │
│  (MV3)       │   stdin/stdout       │  (same Rust core)    │
└──────────────┘                      └──────────────────────┘
```

- The desktop app creates and unlocks the vault and writes its path to `~/.config/safekey/config.json`. That file contains the path only, never a secret.
- The native host reads that path, unlocks the vault with the master password entered in the extension popup, and keeps it open in memory while the browser is running.
- The extension detects login forms, offers matching credentials for the current hostname, and prompts to save new ones on submit.

## Quick start

### 1. Prerequisites

| Tool | Notes |
|------|-------|
| Rust stable | Install with [rustup](https://rustup.rs). SQLCipher is compiled from source, so a C toolchain is required. |
| Node.js + pnpm | pnpm is used for both the app and the extension. |
| Linux system libraries | See below. |

Ubuntu 24.04 packages (run as a single line):

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev pkg-config
```

### 2. Run the desktop app

```bash
pnpm install
pnpm tauri dev
```

Create a vault by choosing a file path and a master password (12 characters minimum). Put the vault inside a synced folder such as Dropbox or Drive if you want it on more than one machine. Safekey never syncs anything itself.

### 3. Build and load the extension

```bash
cd extension
pnpm install
pnpm build          # outputs to extension/dist/
```

| Browser | How to load |
|---------|-------------|
| Chrome / Chromium / Brave | `chrome://extensions` → Developer mode → Load unpacked → select `extension/dist/` |
| Firefox 109+ | `about:debugging` → This Firefox → Load Temporary Add-on → select `extension/dist/manifest.json` |

### 4. Install the native messaging host

```bash
./native-host/install.sh
```

The script builds `safekey-host` in release mode and registers it for Chrome, Chromium, Brave and Firefox.

For Chromium-based browsers one manual step remains: copy the extension ID shown in `chrome://extensions` and replace `REPLACE_WITH_YOUR_EXTENSION_ID` in `~/.config/google-chrome/NativeMessagingHosts/com.safekey.host.json` (same for the Chromium and Brave directories). Firefox uses the fixed add-on ID from the manifest and needs no edit.

### 5. Verify

- [ ] The desktop app opens the vault and lists entries.
- [ ] The extension popup finds the configured vault and accepts the master password.
- [ ] A site with a saved entry shows the 🔐 button in its password field.

## Security model

| Layer | Decision |
|-------|----------|
| Key derivation | Argon2id, 64 MB memory, 3 iterations, 4 lanes, 256-bit output. Random 16-byte salt stored in a companion `.salt` file next to the vault. |
| Vault at rest | SQLCipher keyed with the raw Argon2id-derived key. 4096-byte pages, HMAC-SHA512, WAL journal. |
| Field encryption | Passwords and notes are additionally encrypted with AES-256-GCM using a fresh random 12-byte nonce per value. Compromise of the database file alone still requires the master key. |
| Secrets in memory | Keys are wrapped in `secrecy` and zeroized on lock or drop. |
| Extension boundary | The background worker validates every message from content scripts (hostname format, UUID format) before forwarding to the host. |
| Network | None. There is no server component. |

Things to know:

- **Keep `vault.db` and `vault.salt` together.** Without the salt file the vault cannot be unlocked, even with the right password.
- **The native host holds the unlocked vault in memory** for as long as the browser keeps the connection alive. Lock it from the popup when you step away.
- **Sync is your responsibility.** The vault is a regular file. Conflicts from concurrent edits on two machines are not handled yet.

## Native messaging protocol

Standard browser native messaging: each message is a 4-byte little-endian length prefix followed by a JSON payload on stdin/stdout. Chrome and Firefox share the protocol and differ only in the host manifest (`allowed_origins` vs `allowed_extensions`).

| Request | Purpose |
|---------|---------|
| `get_status` | Whether a vault is configured and whether it is unlocked |
| `unlock` | Unlock with the master password |
| `lock` | Drop the key from memory |
| `find_credentials` | Entries matching a hostname (no passwords) |
| `get_password` | Decrypted password for one entry ID |
| `save_credential` | Create a new entry captured from a form submit |

## Project layout

| Path | Role |
|------|------|
| `src-tauri/src/crypto/` | Argon2id, AES-256-GCM, salt and nonce generation, zeroized buffers |
| `src-tauri/src/db/` | SQLCipher connection setup and schema migrations |
| `src-tauri/src/vault/` | `VaultManager` with entry CRUD and hostname lookup |
| `src-tauri/src/commands/` | Tauri commands exposed to the React frontend |
| `src-tauri/src/config.rs` | `~/.config/safekey/config.json` read/write |
| `src-tauri/src/bin/safekey_host.rs` | Native messaging host binary |
| `src/` | React frontend: unlock screen, entry list, entry form, `useVault` hook |
| `extension/src/` | Background service worker, content script, popup |
| `native-host/` | Host manifest templates and installer |

## Development

```bash
# Rust unit tests (crypto, config)
cargo test --lib --manifest-path src-tauri/Cargo.toml

# Frontend typecheck
pnpm exec tsc --noEmit

# Extension typecheck and rebuild on change
cd extension && pnpm typecheck && pnpm watch
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/).

## Roadmap

- [x] Encrypted vault with Argon2id + SQLCipher + AES-256-GCM
- [x] Desktop app: create, unlock, list, add, edit, delete, copy, generate
- [x] Browser extension with auto-fill and save prompt
- [x] Native messaging host for Chrome, Chromium, Brave and Firefox
- [x] Remember last vault path on the unlock screen
- [ ] Import / export
- [ ] UI polish
- [ ] Windows and macOS native host installer
- [ ] Frontend test suite

## License

Safekey is source-available under the [Functional Source License, Version 1.1, Apache 2.0 Future License](LICENSE.md) (SPDX: `FSL-1.1-Apache-2.0`).

In short: you may read, audit, modify and use the software for internal use, education, research and any other non-competing purpose. You may not offer it to others as a commercial product or service that competes with Safekey. Each version becomes available under the Apache License 2.0 two years after it is released. See `LICENSE.md` for the full terms.

