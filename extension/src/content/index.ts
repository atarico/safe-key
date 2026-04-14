import type { ExtMessage, ExtResponse, Entry } from "../types";

// ─── State ───────────────────────────────────────────────────────────────────

const hostname = window.location.hostname.toLowerCase();
let matchedEntries: Entry[] = [];
let autoFillButton: HTMLElement | null = null;

// ─── Communicate with background worker ──────────────────────────────────────

function sendToBackground(msg: ExtMessage): Promise<ExtResponse> {
  return chrome.runtime.sendMessage(msg);
}

// ─── DOM detection ───────────────────────────────────────────────────────────

interface LoginForm {
  usernameField: HTMLInputElement | null;
  passwordField: HTMLInputElement;
  form: HTMLElement;
}

/**
 * Finds login forms on the page.
 * A login form is any element containing an <input type="password">.
 */
function findLoginForms(): LoginForm[] {
  const passwordFields = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="password"]')
  ).filter(
    (el) =>
      el.offsetParent !== null && // visible
      !el.disabled &&
      !el.readOnly
  );

  return passwordFields.map((passwordField) => {
    const form = passwordField.closest("form") ?? passwordField.parentElement ?? document.body;

    // Find the closest username field (text/email input before the password field)
    const allInputs = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="email"]')
    );

    // Pick the last text/email input before the password field
    const usernameField =
      allInputs.filter((el) => {
        return (
          el.compareDocumentPosition(passwordField) &
          Node.DOCUMENT_POSITION_FOLLOWING
        );
      }).pop() ?? null;

    return { usernameField, passwordField, form };
  });
}

// ─── Auto-fill button ─────────────────────────────────────────────────────────

/**
 * Injects a small "🔐 Safekey" button next to the password field.
 * Clicking it shows the available credentials.
 */
function injectAutoFillButton(form: LoginForm, entries: Entry[]) {
  // Don't inject twice on the same field
  if (autoFillButton?.isConnected) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "safekey-autofill-btn";
  btn.setAttribute("data-safekey", "true");
  btn.title = "Safekey — fill credentials";
  btn.textContent = "🔐";

  // Style: float next to the password field
  Object.assign(btn.style, {
    position: "absolute",
    zIndex: "2147483647",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: "16px",
    padding: "2px 4px",
    borderRadius: "4px",
    opacity: "0.7",
  });

  const rect = form.passwordField.getBoundingClientRect();
  Object.assign(btn.style, {
    top: `${rect.top + window.scrollY + (rect.height - 22) / 2}px`,
    left: `${rect.left + window.scrollX + rect.width - 28}px`,
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (entries.length === 1) {
      // Single match — fill immediately
      fillForm(form, entries[0]);
    } else {
      // Multiple matches — show picker
      showPicker(form, entries, btn);
    }
  });

  btn.addEventListener("mouseover", () => (btn.style.opacity = "1"));
  btn.addEventListener("mouseout", () => (btn.style.opacity = "0.7"));

  document.body.appendChild(btn);
  autoFillButton = btn;
}

function fillForm(form: LoginForm, entry: Entry) {
  if (form.usernameField && entry.username) {
    setNativeValue(form.usernameField, entry.username);
  }

  // Copy password to clipboard and notify user
  sendToBackground({ type: "COPY_PASSWORD", id: entry.id }).then(() => {
    showToast(`✅ Credentials filled for ${entry.site_url}`);
  });
}

/**
 * Fills form fields using native value setters so React/Vue/Angular
 * detect the change event correctly.
 */
function setNativeValue(input: HTMLInputElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

// ─── Credential picker ────────────────────────────────────────────────────────

function showPicker(form: LoginForm, entries: Entry[], anchor: HTMLElement) {
  // Remove existing picker
  document.querySelector("[data-safekey-picker]")?.remove();

  const picker = document.createElement("div");
  picker.setAttribute("data-safekey-picker", "true");

  Object.assign(picker.style, {
    position: "fixed",
    zIndex: "2147483647",
    background: "#1a1d27",
    border: "1px solid #2a2d3e",
    borderRadius: "8px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
    minWidth: "220px",
    padding: "6px 0",
    fontFamily: "system-ui, sans-serif",
    fontSize: "13px",
  });

  // Position below the button
  const rect = anchor.getBoundingClientRect();
  Object.assign(picker.style, {
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
  });

  entries.forEach((entry) => {
    const item = document.createElement("div");
    Object.assign(item.style, {
      padding: "8px 14px",
      cursor: "pointer",
      color: "#e2e8f0",
      display: "flex",
      flexDirection: "column",
      gap: "2px",
    });

    item.innerHTML = `
      <span style="font-weight:600">${escapeHtml(entry.site_url)}</span>
      <span style="color:#8892a4;font-size:12px">${escapeHtml(entry.username)}</span>
    `;

    item.addEventListener("mouseover", () => {
      item.style.background = "#2a2d3e";
    });
    item.addEventListener("mouseout", () => {
      item.style.background = "transparent";
    });
    item.addEventListener("click", () => {
      picker.remove();
      fillForm(form, entry);
    });

    picker.appendChild(item);
  });

  document.body.appendChild(picker);

  // Close on outside click
  const onOutsideClick = (e: MouseEvent) => {
    if (!picker.contains(e.target as Node)) {
      picker.remove();
      document.removeEventListener("click", onOutsideClick);
    }
  };
  setTimeout(() => document.addEventListener("click", onOutsideClick), 0);
}

// ─── Save credential prompt ───────────────────────────────────────────────────

/**
 * Shows a toast asking the user if they want to save a newly submitted credential.
 */
function promptSaveCredential(
  site_url: string,
  username: string,
  password: string
) {
  const banner = document.createElement("div");
  banner.setAttribute("data-safekey-save-prompt", "true");

  Object.assign(banner.style, {
    position: "fixed",
    top: "16px",
    right: "16px",
    zIndex: "2147483647",
    background: "#1a1d27",
    border: "1px solid #6c63ff",
    borderRadius: "10px",
    padding: "14px 18px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    fontFamily: "system-ui, sans-serif",
    fontSize: "13px",
    color: "#e2e8f0",
    maxWidth: "320px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  });

  banner.innerHTML = `
    <div style="font-weight:700;display:flex;gap:8px;align-items:center">
      🔐 <span>Save password for ${escapeHtml(site_url)}?</span>
    </div>
    <div style="color:#8892a4;font-size:12px">${escapeHtml(username)}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button data-safekey-action="dismiss" style="padding:5px 12px;background:#2a2d3e;border:1px solid #3a3d4e;border-radius:5px;color:#e2e8f0;cursor:pointer;font-size:12px">Not now</button>
      <button data-safekey-action="save" style="padding:5px 12px;background:#6c63ff;border:none;border-radius:5px;color:#fff;cursor:pointer;font-size:12px;font-weight:600">Save</button>
    </div>
  `;

  banner
    .querySelector('[data-safekey-action="save"]')
    ?.addEventListener("click", async () => {
      banner.remove();
      const resp = await sendToBackground({
        type: "SAVE_CREDENTIAL",
        site_url,
        username,
        password,
      });
      if (resp.ok) {
        showToast("✅ Password saved in Safekey");
      } else if (resp.locked) {
        showToast("🔒 Vault is locked — open Safekey to save");
      }
    });

  banner
    .querySelector('[data-safekey-action="dismiss"]')
    ?.addEventListener("click", () => banner.remove());

  document.body.appendChild(banner);

  // Auto-dismiss after 15 seconds
  setTimeout(() => banner.remove(), 15000);
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(message: string) {
  const toast = document.createElement("div");
  Object.assign(toast.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "2147483647",
    background: "#1a1d27",
    border: "1px solid #2a2d3e",
    borderRadius: "8px",
    padding: "10px 16px",
    fontFamily: "system-ui, sans-serif",
    fontSize: "13px",
    color: "#e2e8f0",
    boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
    transition: "opacity 0.3s",
  });
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ─── Form submit detection ────────────────────────────────────────────────────

function watchFormSubmits() {
  document.addEventListener(
    "submit",
    (e) => {
      const form = e.target as HTMLFormElement;
      const passwordField = form.querySelector<HTMLInputElement>(
        'input[type="password"]'
      );
      if (!passwordField || !passwordField.value) return;

      const usernameField =
        form.querySelector<HTMLInputElement>('input[type="text"], input[type="email"]');
      const username = usernameField?.value ?? "";
      const password = passwordField.value;

      // Don't prompt if we already have this credential
      const alreadySaved = matchedEntries.some(
        (e) => e.username === username
      );
      if (alreadySaved) return;

      promptSaveCredential(hostname, username, password);
    },
    true // capture phase — runs before the page's own handlers
  );
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const forms = findLoginForms();
  if (forms.length === 0) return;

  // Ask background for credentials matching this hostname
  const resp = await sendToBackground({
    type: "GET_CREDENTIALS_FOR_PAGE",
    hostname,
  });

  if (!resp.ok || !resp.data) return;

  matchedEntries = resp.data as Entry[];

  if (matchedEntries.length > 0) {
    // Inject auto-fill button on each login form found
    forms.forEach((form) => injectAutoFillButton(form, matchedEntries));
  }

  // Watch for new forms (SPAs that render login forms dynamically)
  const observer = new MutationObserver(() => {
    const newForms = findLoginForms();
    if (newForms.length > 0 && matchedEntries.length > 0) {
      newForms.forEach((form) => injectAutoFillButton(form, matchedEntries));
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  watchFormSubmits();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Run when the page is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
