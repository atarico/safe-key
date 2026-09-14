import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntryList } from "./EntryList";
import type { Entry } from "../lib/tauri";

// EntryList takes every callback as a prop, so `vi.fn()` doubles are the seam.
// Queries go through accessible names, which keeps them honest: if a control
// loses its name, these tests go red instead of quietly passing.

const anEntry = (overrides: Partial<Entry> = {}): Entry => ({
  id: "entry-1",
  site_url: "github.com",
  username: "ada",
  created_at: 0,
  updated_at: 0,
  ...overrides,
});

const entries = [
  anEntry(),
  anEntry({ id: "entry-2", site_url: "gitlab.com", username: "grace" }),
];

const searchField = () => screen.getByLabelText("Buscar entradas");

function renderList(props: Partial<Parameters<typeof EntryList>[0]> = {}) {
  const handlers = {
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onCopyPassword: vi.fn().mockResolvedValue(true),
  };
  const user = userEvent.setup();
  const view = render(
    <EntryList entries={entries} {...handlers} {...props} />
  );
  return { ...view, ...handlers, ...props, user };
}

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  confirmSpy.mockRestore();
});

describe("EntryList", () => {
  it("lists each entry's site and username", () => {
    renderList();

    expect(screen.getByText("github.com")).toBeInTheDocument();
    expect(screen.getByText("ada")).toBeInTheDocument();
    expect(screen.getByText("gitlab.com")).toBeInTheDocument();
    expect(screen.getByText("grace")).toBeInTheDocument();
  });

  it("invites the user to add a password when the vault is empty", () => {
    renderList({ entries: [] });

    expect(screen.getByText("Tu vault está vacío")).toBeInTheDocument();
  });

  it("filters by site and by username, ignoring case", async () => {
    const { user } = renderList();

    await user.type(searchField(), "GITLAB");
    expect(screen.queryByText("github.com")).not.toBeInTheDocument();
    expect(screen.getByText("gitlab.com")).toBeInTheDocument();

    await user.clear(searchField());
    await user.type(searchField(), "Ada");
    expect(screen.getByText("github.com")).toBeInTheDocument();
    expect(screen.queryByText("gitlab.com")).not.toBeInTheDocument();
  });

  it("says nothing matched rather than claiming the vault is empty", async () => {
    const { user } = renderList();

    await user.type(searchField(), "bitbucket");

    expect(
      screen.getByText('No hay entradas que coincidan con "bitbucket"')
    ).toBeInTheDocument();
    expect(screen.queryByText("Tu vault está vacío")).not.toBeInTheDocument();
  });

  it("offers a way to clear the search only once there is one", async () => {
    const { user } = renderList();

    expect(
      screen.queryByRole("button", { name: "Limpiar búsqueda" })
    ).not.toBeInTheDocument();

    await user.type(searchField(), "gitlab");
    await user.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));

    expect(searchField()).toHaveValue("");
    expect(screen.getByText("github.com")).toBeInTheDocument();
  });

  it("copies the password of the entry whose button was pressed", async () => {
    const { onCopyPassword, user } = renderList();

    await user.click(screen.getAllByTitle("Copiar contraseña")[1]);

    expect(onCopyPassword).toHaveBeenCalledWith("entry-2");
  });

  it("confirms the copy succeeded on that entry alone", async () => {
    const { user } = renderList();

    await user.click(screen.getAllByTitle("Copiar contraseña")[0]);

    const buttons = screen.getAllByTitle("Copiar contraseña");
    expect(buttons[0]).toHaveTextContent("✅");
    expect(buttons[1]).not.toHaveTextContent("✅");
  });

  it("shows no confirmation when the copy fails", async () => {
    const { user } = renderList({
      onCopyPassword: vi.fn().mockResolvedValue(false),
    });

    await user.click(screen.getAllByTitle("Copiar contraseña")[0]);

    expect(screen.getAllByTitle("Copiar contraseña")[0]).not.toHaveTextContent(
      "✅"
    );
  });

  it("hands the chosen entry to the edit handler", async () => {
    const { onEdit, user } = renderList();

    await user.click(screen.getAllByTitle("Editar")[1]);

    expect(onEdit).toHaveBeenCalledWith(entries[1]);
  });

  it("deletes only after the user confirms", async () => {
    const { onDelete, user } = renderList();

    await user.click(screen.getAllByTitle("Eliminar")[0]);

    expect(confirmSpy).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalledWith(entries[0]);
  });

  it("keeps the entry when the user backs out of the confirmation", async () => {
    confirmSpy.mockReturnValue(false);
    const { onDelete, user } = renderList();

    await user.click(screen.getAllByTitle("Eliminar")[0]);

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("github.com")).toBeInTheDocument();
  });
});
