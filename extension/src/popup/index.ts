import type { Entry, ExtMessage, ExtResponse, VaultStatus } from "../types";

// ─── State ───────────────────────────────────────────────────────────────────

type View = "loading" | "unlock" | "entries" | "no_vault";

interface State {
  view: View;
  hostname: string;
  entries: Entry[];
  error: string | null;
  loading: boolean;
  copied: string | null;
}

const state: State = {
  view: "loading",
  hostname: "",
  entries: [],
  error: null,
  loading: false,
  copied: null,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function send(msg: ExtMessage): Promise<ExtResponse> {
  return chrome.runtime.sendMessage(msg);
}

function render() {
  const root = document.getElementById("root")!;
  root.innerHTML = "";
  root.appendChild(buildView());
}

function esc(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ─── Views ───────────────────────────────────────────────────────────────────

function buildView(): HTMLElement {
  const header = buildHeader();
  const body = document.createElement("div");
  body.style.flex = "1";
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.overflow = "hidden";

  switch (state.view) {
    case "loading":
      body.appendChild(buildEmpty("⏳", "Connecting to Safekey...", ""));
      break;
    case "no_vault":
      body.appendChild(
        buildEmpty(
          "⚠️",
          "No vault configured",
          "Open Safekey and create or unlock a vault first."
        )
      );
      break;
    case "unlock":
      body.appendChild(buildUnlockView());
      break;
    case "entries":
      body.appendChild(buildEntriesView());
      break;
  }

  if (state.error) {
    const err = document.createElement("div");
    err.className = "error-bar";
    err.textContent = state.error;
    body.appendChild(err);
  }

  if (state.copied) {
    const badge = document.createElement("div");
    badge.className = "copied-badge";
    badge.textContent = "✅ Copied!";
    body.appendChild(badge);
    setTimeout(() => badge.remove(), 2100);
  }

  const wrapper = document.createElement("div");
  wrapper.id = "root-inner";
  wrapper.style.cssText = "display:flex;flex-direction:column;height:100%;overflow:hidden";
  wrapper.appendChild(header);
  wrapper.appendChild(body);
  return wrapper;
}

function buildHeader(): HTMLElement {
  const header = document.createElement("header");
  header.className = "header";

  const left = document.createElement("div");
  left.className = "header-left";

  const logo = document.createElement("span");
  logo.className = "header-logo";
  logo.textContent = "🔐";

  const titleBlock = document.createElement("div");
  const title = document.createElement("div");
  title.className = "header-title";
  title.textContent = "Safekey";

  if (state.hostname) {
    const host = document.createElement("div");
    host.className = "header-hostname";
    host.textContent = state.hostname;
    titleBlock.appendChild(title);
    titleBlock.appendChild(host);
  } else {
    titleBlock.appendChild(title);
  }

  left.appendChild(logo);
  left.appendChild(titleBlock);
  header.appendChild(left);

  // Lock button (only when unlocked)
  if (state.view === "entries") {
    const lockBtn = document.createElement("button");
    lockBtn.className = "btn-icon";
    lockBtn.title = "Lock vault";
    lockBtn.textContent = "🔒";
    lockBtn.addEventListener("click", handleLock);
    header.appendChild(lockBtn);
  }

  return header;
}

function buildUnlockView(): HTMLElement {
  const view = document.createElement("div");
  view.className = "unlock-view";

  const h2 = document.createElement("h2");
  h2.textContent = "🔐 Vault is locked";
  const p = document.createElement("p");
  p.textContent = "Enter your master password to unlock.";

  const field = document.createElement("div");
  field.className = "field";
  const label = document.createElement("label");
  label.textContent = "Master password";
  const input = document.createElement("input");
  input.type = "password";
  input.placeholder = "Your master password";
  input.autocomplete = "current-password";
  input.disabled = state.loading;
  field.appendChild(label);
  field.appendChild(input);

  const btn = document.createElement("button");
  btn.className = "btn-primary";
  btn.textContent = state.loading ? "Unlocking..." : "Unlock";
  btn.disabled = state.loading;

  const submit = () => {
    if (input.value) handleUnlock(input.value);
  };

  btn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });

  view.appendChild(h2);
  view.appendChild(p);
  view.appendChild(field);
  view.appendChild(btn);

  // Focus the input after render
  requestAnimationFrame(() => input.focus());

  return view;
}

function buildEntriesView(): HTMLElement {
  const view = document.createElement("div");
  view.className = "entries-view";

  if (state.entries.length === 0) {
    view.appendChild(
      buildEmpty(
        "🔑",
        `No credentials for ${state.hostname || "this site"}`,
        "Add them in the Safekey app."
      )
    );
    return view;
  }

  const label = document.createElement("div");
  label.className = "site-label";
  label.textContent = `${state.entries.length} credential${state.entries.length !== 1 ? "s" : ""} for ${state.hostname}`;
  view.appendChild(label);

  const list = document.createElement("div");
  list.className = "entries-list";

  state.entries.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "entry-item";

    const avatar = document.createElement("div");
    avatar.className = "entry-avatar";
    avatar.textContent = entry.site_url.charAt(0).toUpperCase();

    const info = document.createElement("div");
    info.className = "entry-info";
    info.innerHTML = `
      <span class="entry-site">${esc(entry.site_url)}</span>
      <span class="entry-user">${esc(entry.username)}</span>
    `;

    const actions = document.createElement("div");
    actions.className = "entry-actions";

    const fillBtn = document.createElement("button");
    fillBtn.className = "btn-fill";
    fillBtn.textContent = "Fill";
    fillBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleFill(entry);
    });

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-icon btn-copy";
    copyBtn.title = "Copy password";
    copyBtn.textContent = "📋";
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleCopy(entry.id);
    });

    actions.appendChild(fillBtn);
    actions.appendChild(copyBtn);

    item.appendChild(avatar);
    item.appendChild(info);
    item.appendChild(actions);

    item.addEventListener("click", () => handleFill(entry));
    list.appendChild(item);
  });

  view.appendChild(list);
  return view;
}

function buildEmpty(icon: string, title: string, hint: string): HTMLElement {
  const div = document.createElement("div");
  div.className = "empty-state";
  div.innerHTML = `
    <span class="empty-icon">${icon}</span>
    <span>${esc(title)}</span>
    ${hint ? `<span class="empty-hint">${esc(hint)}</span>` : ""}
  `;
  return div;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function handleUnlock(password: string) {
  state.loading = true;
  state.error = null;
  render();

  const resp = await send({ type: "UNLOCK", password });

  if (resp.ok) {
    await loadEntries();
  } else {
    state.error = resp.error;
    state.loading = false;
    render();
  }
}

async function handleLock() {
  await send({ type: "LOCK" });
  state.view = "unlock";
  state.entries = [];
  state.error = null;
  render();
}

async function handleFill(entry: Entry) {
  // Send fill message to the active tab's content script
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) return;

    // Get the password from the native host
    const resp = await send({ type: "COPY_PASSWORD", id: entry.id });

    if (!resp.ok) {
      state.error = resp.error;
      render();
      return;
    }

    // Ask content script to fill the form
    // The content script handles the actual DOM manipulation
    await chrome.tabs.sendMessage(tab.id, {
      type: "FILL_FORM",
      username: entry.username,
      // Password is in clipboard — content script reads it
    });

    window.close();
  } catch {
    state.error = "Could not communicate with the page";
    render();
  }
}

async function handleCopy(id: string) {
  const resp = await send({ type: "COPY_PASSWORD", id });
  if (resp.ok) {
    state.copied = id;
    render();
    setTimeout(() => {
      state.copied = null;
      render();
    }, 2200);
  } else {
    state.error = resp.error;
    render();
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function loadEntries() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ? new URL(tab.url) : null;
  state.hostname = url?.hostname ?? "";

  const resp = await send({
    type: "GET_CREDENTIALS_FOR_PAGE",
    hostname: state.hostname,
  });

  state.loading = false;

  if (resp.ok) {
    state.entries = (resp.data as Entry[]) ?? [];
    state.view = "entries";
  } else if (resp.locked) {
    state.view = "unlock";
  } else {
    state.error = resp.error;
    state.view = "entries";
    state.entries = [];
  }

  render();
}

async function init() {
  render(); // Show loading

  const resp = await send({ type: "GET_STATUS" });

  if (!resp.ok) {
    state.view = "unlock";
    render();
    return;
  }

  const status = resp.data as VaultStatus;

  if (!status.vault_configured) {
    state.view = "no_vault";
    render();
    return;
  }

  if (!status.unlocked) {
    state.view = "unlock";
    render();
    return;
  }

  await loadEntries();
}

document.addEventListener("DOMContentLoaded", init);
