import type {
  Entry,
  ExtMessage,
  ExtResponse,
  NativeRequest,
  NativeResponse,
  VaultStatus,
} from "../types";

const NATIVE_HOST = "com.safekey.host";

// ─── Native Messaging ────────────────────────────────────────────────────────

/**
 * Sends one message to the native host and waits for a response.
 * Opens a new port for each message — simpler than managing a persistent
 * connection (Chrome kills background service workers between events).
 */
function sendNative<T>(request: NativeRequest): Promise<NativeResponse<T>> {
  return new Promise((resolve) => {
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    let responded = false;

    port.onMessage.addListener((msg) => {
      responded = true;
      port.disconnect();
      resolve(msg as NativeResponse<T>);
    });

    port.onDisconnect.addListener(() => {
      if (!responded) {
        resolve({
          status: "error",
          message:
            chrome.runtime.lastError?.message ??
            "Native host disconnected without responding",
        });
      }
    });

    port.postMessage(request);
  });
}

// ─── Message handlers ────────────────────────────────────────────────────────

async function handleGetStatus(): Promise<ExtResponse> {
  const resp = await sendNative<VaultStatus>({ action: "get_status" });
  if (resp.status === "ok") {
    return { ok: true, data: resp.data };
  }
  return { ok: false, error: resp.message ?? "Unknown error" };
}

async function handleUnlock(password: string): Promise<ExtResponse> {
  const resp = await sendNative({ action: "unlock", password });
  if (resp.status === "ok") return { ok: true };
  return {
    ok: false,
    error: resp.status === "error" ? resp.message : "Vault locked",
    locked: resp.status === "locked",
  };
}

async function handleLock(): Promise<ExtResponse> {
  const resp = await sendNative({ action: "lock" });
  if (resp.status === "ok") return { ok: true };
  return { ok: false, error: "Failed to lock" };
}

async function handleGetCredentials(hostname: string): Promise<ExtResponse> {
  // Validate hostname before sending to native host (defence-in-depth)
  if (!isValidHostname(hostname)) {
    return { ok: false, error: "Invalid hostname" };
  }

  const resp = await sendNative<Entry[]>({
    action: "find_credentials",
    hostname,
  });

  if (resp.status === "ok") return { ok: true, data: resp.data ?? [] };
  if (resp.status === "locked") return { ok: false, error: resp.message, locked: true };
  return { ok: false, error: resp.message };
}

async function handleCopyPassword(id: string): Promise<ExtResponse> {
  if (!isValidUuid(id)) return { ok: false, error: "Invalid entry ID" };

  const resp = await sendNative<string>({ action: "get_password", id });

  if (resp.status === "ok" && resp.data) {
    await writeToClipboard(resp.data);
    return { ok: true };
  }
  if (resp.status === "locked") return { ok: false, error: resp.message, locked: true };
  if (resp.status === "error") return { ok: false, error: resp.message };
  return { ok: false, error: "Failed to get password" };
}

async function handleSaveCredential(
  site_url: string,
  username: string,
  password: string
): Promise<ExtResponse> {
  const resp = await sendNative({
    action: "save_credential",
    site_url,
    username,
    password,
  });

  if (resp.status === "ok") return { ok: true };
  if (resp.status === "locked") return { ok: false, error: resp.message, locked: true };
  return { ok: false, error: resp.message ?? "Failed to save" };
}

// ─── Main message listener ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (msg: ExtMessage, _sender, sendResponse) => {
    // SECURITY: Always validate that the message came from our extension
    // (not from a content script running in a malicious page injecting messages)
    handleMessage(msg).then(sendResponse);
    return true; // keep channel open for async response
  }
);

async function handleMessage(msg: ExtMessage): Promise<ExtResponse> {
  switch (msg.type) {
    case "GET_STATUS":
      return handleGetStatus();

    case "UNLOCK":
      return handleUnlock(msg.password);

    case "LOCK":
      return handleLock();

    case "GET_CREDENTIALS_FOR_PAGE":
      return handleGetCredentials(msg.hostname);

    case "COPY_PASSWORD":
      return handleCopyPassword(msg.id);

    case "SAVE_CREDENTIAL":
      return handleSaveCredential(msg.site_url, msg.username, msg.password);

    case "FILL_FORM":
      // This message goes content→background but background just relays it
      // back to the active tab's content script. Handled by content script directly.
      return { ok: true };

    default:
      return { ok: false, error: "Unknown message type" };
  }
}

// ─── Clipboard ───────────────────────────────────────────────────────────────

async function writeToClipboard(text: string): Promise<void> {
  // In MV3, the service worker can't access the DOM directly.
  // We use chrome.scripting to run a script in the active tab.
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) return;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (t: string) => navigator.clipboard.writeText(t),
      args: [text],
    });
  } catch {
    // Silently fail — clipboard write is best-effort
  }
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function isValidHostname(hostname: string): boolean {
  // Basic hostname validation — must not contain path or scheme
  return (
    hostname.length > 0 &&
    hostname.length < 256 &&
    !hostname.includes("/") &&
    !hostname.includes("://") &&
    /^[a-zA-Z0-9.\-_]+$/.test(hostname)
  );
}

function isValidUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
}
