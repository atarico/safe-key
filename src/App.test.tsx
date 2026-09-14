import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import * as api from "./lib/tauri";
import { useVault } from "./hooks/useVault";
import type { Entry } from "./lib/tauri";

// App wires the vault hook to the screens. Both of its collaborators are
// doubled so the tests exercise the wiring itself: which handler runs, and
// what it forwards.
vi.mock("./lib/tauri", () => ({ getEntryPassword: vi.fn() }));
vi.mock("./hooks/useVault", () => ({ useVault: vi.fn() }));

const entry: Entry = {
  id: "entry-1",
  site_url: "github.com",
  username: "ada",
  created_at: 0,
  updated_at: 0,
};

function vaultState(overrides: Partial<ReturnType<typeof useVault>> = {}) {
  const state = {
    status: "unlocked" as const,
    entries: [entry],
    error: null,
    loading: false,
    lastVaultPath: null,
    clearError: vi.fn(),
    createVault: vi.fn(),
    unlock: vi.fn(),
    lock: vi.fn(),
    addEntry: vi.fn().mockResolvedValue(true),
    editEntry: vi.fn().mockResolvedValue(true),
    removeEntry: vi.fn().mockResolvedValue(true),
    copyPassword: vi.fn().mockResolvedValue(true),
    refreshEntries: vi.fn(),
    ...overrides,
  };
  vi.mocked(useVault).mockReturnValue(state);
  return state;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("App", () => {
  it("asks for the master password while the vault is locked", () => {
    vaultState({ status: "locked", entries: [] });
    render(<App />);

    expect(screen.getByLabelText("Master password")).toBeInTheDocument();
  });

  it("shows the vault once it is unlocked", () => {
    vaultState();
    render(<App />);

    expect(screen.getByText("github.com")).toBeInTheDocument();
    expect(screen.getByText("1 entrada")).toBeInTheDocument();
  });

  it("locks the vault on request", async () => {
    const vault = vaultState();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByTitle("Bloquear vault"));

    expect(vault.lock).toHaveBeenCalled();
  });

  it("saves a new entry and closes the form", async () => {
    const vault = vaultState();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByTitle("Nueva entrada"));
    await user.type(screen.getByLabelText("Sitio web"), "gitlab.com");
    await user.type(screen.getByLabelText("Usuario"), "grace");
    await user.type(screen.getByLabelText(/^Contraseña/), "s3cret");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(vault.addEntry).toHaveBeenCalledWith({
      site_url: "gitlab.com",
      username: "grace",
      password: "s3cret",
      notes: undefined,
    });
    expect(screen.queryByText("Nueva entrada")).not.toBeInTheDocument();
  });

  it("keeps the stored password when an edit leaves the field untouched", async () => {
    const vault = vaultState();
    vi.mocked(api.getEntryPassword).mockResolvedValue("stored-secret");
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByTitle("Editar"));
    await user.type(screen.getByLabelText("Usuario"), ".lovelace");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(api.getEntryPassword).toHaveBeenCalledWith("entry-1");
    expect(vault.editEntry).toHaveBeenCalledWith("entry-1", {
      site_url: "github.com",
      username: "ada.lovelace",
      password: "stored-secret",
      notes: undefined,
    });
  });

  it("overwrites the password when the user types one, sentinel-looking or not", async () => {
    const vault = vaultState();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByTitle("Editar"));
    await user.type(screen.getByLabelText(/^Contraseña/), "__KEEP__");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // The old sentinel is now just a password like any other.
    expect(api.getEntryPassword).not.toHaveBeenCalled();
    expect(vault.editEntry).toHaveBeenCalledWith(
      "entry-1",
      expect.objectContaining({ password: "__KEEP__" })
    );
  });

  it("surfaces a vault error and dismisses it on click", async () => {
    const vault = vaultState({ error: "Contraseña incorrecta" });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByText(/Contraseña incorrecta/));

    expect(vault.clearError).toHaveBeenCalled();
  });
});
