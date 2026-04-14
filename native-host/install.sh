#!/usr/bin/env bash
# Installs the Safekey native messaging host for Chrome and Firefox.
# Run this after building the project with: cargo build --release

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY_PATH="$(cargo build --release --bin safekey-host --manifest-path "$SCRIPT_DIR/../src-tauri/Cargo.toml" --message-format=json 2>/dev/null | jq -r 'select(.reason=="compiler-artifact" and .target.name=="safekey-host") | .executable' | tail -1)"

if [[ -z "$BINARY_PATH" ]]; then
  # Fallback: find the binary directly
  BINARY_PATH="$SCRIPT_DIR/../src-tauri/target/release/safekey-host"
fi

if [[ ! -f "$BINARY_PATH" ]]; then
  echo "Error: safekey-host binary not found at $BINARY_PATH"
  echo "Run 'cargo build --release' first."
  exit 1
fi

echo "Installing Safekey native host..."
echo "  Binary: $BINARY_PATH"

# ─── Chrome / Chromium ───────────────────────────────────────────────────────

CHROME_HOSTS_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
CHROMIUM_HOSTS_DIR="$HOME/.config/chromium/NativeMessagingHosts"
BRAVE_HOSTS_DIR="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"

for DIR in "$CHROME_HOSTS_DIR" "$CHROMIUM_HOSTS_DIR" "$BRAVE_HOSTS_DIR"; do
  mkdir -p "$DIR"
  sed "s|{{BINARY_PATH}}|$BINARY_PATH|g; s|{{CHROME_EXTENSION_ID}}|REPLACE_WITH_YOUR_EXTENSION_ID|g; s|{{BRAVE_EXTENSION_ID}}|REPLACE_WITH_YOUR_EXTENSION_ID|g" \
    "$SCRIPT_DIR/com.safekey.host.json.template" > "$DIR/com.safekey.host.json"
  echo "  Installed for: $DIR"
done

# ─── Firefox ─────────────────────────────────────────────────────────────────

FIREFOX_HOSTS_DIR="$HOME/.mozilla/native-messaging-hosts"
mkdir -p "$FIREFOX_HOSTS_DIR"
sed "s|{{BINARY_PATH}}|$BINARY_PATH|g" \
  "$SCRIPT_DIR/com.safekey.host.firefox.json.template" > "$FIREFOX_HOSTS_DIR/com.safekey.host.json"
echo "  Installed for Firefox: $FIREFOX_HOSTS_DIR"

echo ""
echo "Done! Now load the extension in your browser:"
echo "  Chrome: chrome://extensions → Developer mode → Load unpacked → select extension/dist/"
echo "  Firefox: about:debugging → Load Temporary Add-on → select extension/dist/manifest.json"
echo ""
echo "IMPORTANT: Update the extension ID in the Chrome/Chromium/Brave manifests after loading:"
echo "  Edit ~/.config/google-chrome/NativeMessagingHosts/com.safekey.host.json"
echo "  Replace REPLACE_WITH_YOUR_EXTENSION_ID with the actual extension ID from chrome://extensions"
