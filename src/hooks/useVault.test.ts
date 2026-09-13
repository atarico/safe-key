import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useVault } from "./useVault";
import * as api from "../lib/tauri";
import type { Entry } from "../lib/tauri";

// `useVault` reaches the Rust core exclusively through `src/lib/tauri.ts`.
// That module is the seam: doubling it keeps this suite on the hook's own
// behaviour instead of the Tauri IPC bridge.
vi.mock("../lib/tauri", () => ({
  createVault: vi.fn(),
  unlockVault: vi.fn(),
  lockVault: vi.fn(),
  getLastVaultPath: vi.fn(),
  listEntries: vi.fn(),
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
  getEntryPassword: vi.fn(),
}));

const VAULT_PATH = "/home/user/vault.db";
const MASTER_PASSWORD = "correct horse battery staple";

const anEntry = (overrides: Partial<Entry> = {}): Entry => ({
  id: "entry-1",
  site_url: "https://example.com",
  username: "ada",
  created_at: 0,
  updated_at: 0,
  ...overrides,
});

const writeText = vi.fn();

/**
 * Renders the hook and flushes the mount effect that loads the last vault
 * path, so every test starts from a settled state.
 */
async function renderVault() {
  const view = renderHook(() => useVault());
  await act(async () => {});
  return view;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getLastVaultPath).mockResolvedValue(null);
  vi.mocked(api.listEntries).mockResolvedValue([]);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

describe("useVault", () => {
  it("starts locked with no entries", async () => {
    const { result } = await renderVault();

    expect(result.current.status).toBe("locked");
    expect(result.current.entries).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("exposes the last used vault path so the unlock screen can prefill it", async () => {
    vi.mocked(api.getLastVaultPath).mockResolvedValue(VAULT_PATH);

    const { result } = await renderVault();

    expect(result.current.lastVaultPath).toBe(VAULT_PATH);
  });

  it("stays usable when the last vault path cannot be read", async () => {
    vi.mocked(api.getLastVaultPath).mockRejectedValue("no config file");

    const { result } = await renderVault();

    expect(result.current.lastVaultPath).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("unlocks the vault and loads its entries", async () => {
    const stored = [anEntry(), anEntry({ id: "entry-2", username: "grace" })];
    vi.mocked(api.listEntries).mockResolvedValue(stored);

    const { result } = await renderVault();
    await act(async () => {
      await result.current.unlock(VAULT_PATH, MASTER_PASSWORD);
    });

    expect(api.unlockVault).toHaveBeenCalledWith(VAULT_PATH, MASTER_PASSWORD);
    expect(result.current.status).toBe("unlocked");
    expect(result.current.entries).toEqual(stored);
    expect(result.current.loading).toBe(false);
  });

  it("stays locked and surfaces the error when the master password is wrong", async () => {
    vi.mocked(api.unlockVault).mockRejectedValue("Contraseña incorrecta");

    const { result } = await renderVault();
    await act(async () => {
      await result.current.unlock(VAULT_PATH, "wrong password");
    });

    expect(result.current.status).toBe("locked");
    expect(result.current.error).toContain("Contraseña incorrecta");
    expect(result.current.entries).toEqual([]);
    expect(api.listEntries).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it("leaves a freshly created vault unlocked and empty", async () => {
    const { result } = await renderVault();
    await act(async () => {
      await result.current.createVault(VAULT_PATH, MASTER_PASSWORD);
    });

    expect(api.createVault).toHaveBeenCalledWith(VAULT_PATH, MASTER_PASSWORD);
    expect(result.current.status).toBe("unlocked");
    expect(result.current.entries).toEqual([]);
    expect(api.listEntries).not.toHaveBeenCalled();
  });

  it("drops the entries from memory when the vault is locked", async () => {
    vi.mocked(api.listEntries).mockResolvedValue([anEntry()]);

    const { result } = await renderVault();
    await act(async () => {
      await result.current.unlock(VAULT_PATH, MASTER_PASSWORD);
    });
    await act(async () => {
      await result.current.lock();
    });

    expect(api.lockVault).toHaveBeenCalled();
    expect(result.current.status).toBe("locked");
    expect(result.current.entries).toEqual([]);
  });

  it("reloads the entry list after adding an entry", async () => {
    const created = anEntry({ id: "entry-new", site_url: "https://new.test" });
    vi.mocked(api.listEntries)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([created]);

    const { result } = await renderVault();
    await act(async () => {
      await result.current.unlock(VAULT_PATH, MASTER_PASSWORD);
    });

    let added: boolean | undefined;
    await act(async () => {
      added = await result.current.addEntry({
        site_url: "https://new.test",
        username: "ada",
        password: "s3cret",
      });
    });

    expect(added).toBe(true);
    expect(result.current.entries).toEqual([created]);
  });

  it("reports failure and leaves the list untouched when adding an entry fails", async () => {
    const existing = [anEntry()];
    vi.mocked(api.listEntries).mockResolvedValue(existing);
    vi.mocked(api.createEntry).mockRejectedValue("vault is locked");

    const { result } = await renderVault();
    await act(async () => {
      await result.current.unlock(VAULT_PATH, MASTER_PASSWORD);
    });

    let added: boolean | undefined;
    await act(async () => {
      added = await result.current.addEntry({
        site_url: "https://new.test",
        username: "ada",
        password: "s3cret",
      });
    });

    expect(added).toBe(false);
    expect(result.current.error).toContain("vault is locked");
    expect(result.current.entries).toEqual(existing);
  });

  it("reloads the entry list after editing an entry", async () => {
    const edited = anEntry({ username: "ada.lovelace" });
    vi.mocked(api.listEntries)
      .mockResolvedValueOnce([anEntry()])
      .mockResolvedValueOnce([edited]);

    const { result } = await renderVault();
    await act(async () => {
      await result.current.unlock(VAULT_PATH, MASTER_PASSWORD);
    });

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.editEntry("entry-1", {
        site_url: "https://example.com",
        username: "ada.lovelace",
        password: "s3cret",
      });
    });

    expect(api.updateEntry).toHaveBeenCalledWith("entry-1", {
      site_url: "https://example.com",
      username: "ada.lovelace",
      password: "s3cret",
    });
    expect(saved).toBe(true);
    expect(result.current.entries).toEqual([edited]);
  });

  it("reports failure and leaves the list untouched when editing an entry fails", async () => {
    const existing = [anEntry()];
    vi.mocked(api.listEntries).mockResolvedValue(existing);
    vi.mocked(api.updateEntry).mockRejectedValue("vault is locked");

    const { result } = await renderVault();
    await act(async () => {
      await result.current.unlock(VAULT_PATH, MASTER_PASSWORD);
    });

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.editEntry("entry-1", {
        site_url: "https://example.com",
        username: "ada.lovelace",
        password: "s3cret",
      });
    });

    expect(saved).toBe(false);
    expect(result.current.error).toContain("vault is locked");
    expect(result.current.entries).toEqual(existing);
  });

  it("removes a deleted entry from the list without refetching the vault", async () => {
    vi.mocked(api.listEntries).mockResolvedValue([
      anEntry(),
      anEntry({ id: "entry-2", username: "grace" }),
    ]);

    const { result } = await renderVault();
    await act(async () => {
      await result.current.unlock(VAULT_PATH, MASTER_PASSWORD);
    });

    let removed: boolean | undefined;
    await act(async () => {
      removed = await result.current.removeEntry("entry-1");
    });

    expect(api.deleteEntry).toHaveBeenCalledWith("entry-1");
    expect(removed).toBe(true);
    expect(result.current.entries.map(e => e.id)).toEqual(["entry-2"]);
    expect(api.listEntries).toHaveBeenCalledTimes(1);
  });

  it("keeps the entry in the list when deleting it fails", async () => {
    const existing = [anEntry()];
    vi.mocked(api.listEntries).mockResolvedValue(existing);
    vi.mocked(api.deleteEntry).mockRejectedValue("vault is locked");

    const { result } = await renderVault();
    await act(async () => {
      await result.current.unlock(VAULT_PATH, MASTER_PASSWORD);
    });

    let removed: boolean | undefined;
    await act(async () => {
      removed = await result.current.removeEntry("entry-1");
    });

    expect(removed).toBe(false);
    expect(result.current.error).toContain("vault is locked");
    expect(result.current.entries).toEqual(existing);
  });

  it("copies the decrypted password to the clipboard and nowhere else", async () => {
    const DECRYPTED = "s3cret-plaintext";
    vi.mocked(api.listEntries).mockResolvedValue([anEntry()]);
    vi.mocked(api.getEntryPassword).mockResolvedValue(DECRYPTED);

    const { result } = await renderVault();
    await act(async () => {
      await result.current.unlock(VAULT_PATH, MASTER_PASSWORD);
    });

    const entriesBeforeCopy = result.current.entries;

    let copied: boolean | undefined;
    await act(async () => {
      copied = await result.current.copyPassword("entry-1");
    });

    expect(api.getEntryPassword).toHaveBeenCalledWith("entry-1");
    expect(writeText).toHaveBeenCalledWith(DECRYPTED);
    expect(copied).toBe(true);

    // The plaintext must reach the clipboard and stop there. Scanning the
    // whole exposed state catches a leak into any field, not just the one
    // field we happened to think of.
    expect(result.current.entries).toEqual(entriesBeforeCopy);
    expect(
      JSON.stringify({
        entries: result.current.entries,
        error: result.current.error,
        lastVaultPath: result.current.lastVaultPath,
      })
    ).not.toContain(DECRYPTED);
  });

  it("reports failure when the password cannot be decrypted", async () => {
    vi.mocked(api.getEntryPassword).mockRejectedValue("vault is locked");

    const { result } = await renderVault();

    let copied: boolean | undefined;
    await act(async () => {
      copied = await result.current.copyPassword("entry-1");
    });

    expect(copied).toBe(false);
    expect(result.current.error).toContain("vault is locked");
    expect(writeText).not.toHaveBeenCalled();
  });

  // The mount effect also carries a `cancelled` guard for resolutions arriving
  // after unmount. React 19 turns a post-unmount state update into a silent
  // no-op, so that guard has no observable effect at this hook's public
  // surface and no test here can prove it. Covering it would mean a test that
  // passes with or without the guard, which is worse than no test at all.
  it("reads the last vault path once, however many times it re-renders", async () => {
    const { rerender } = await renderVault();

    rerender();
    rerender();

    expect(api.getLastVaultPath).toHaveBeenCalledTimes(1);
  });

  it("clears a previous error so the next attempt starts clean", async () => {
    vi.mocked(api.unlockVault).mockRejectedValue("Contraseña incorrecta");

    const { result } = await renderVault();
    await act(async () => {
      await result.current.unlock(VAULT_PATH, "wrong password");
    });
    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });
});
