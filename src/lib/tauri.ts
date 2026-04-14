import { invoke } from "@tauri-apps/api/core";

export interface Entry {
  id: string;
  site_url: string;
  username: string;
  password?: string;
  notes?: string;
  created_at: number;
  updated_at: number;
}

export interface EntryInput {
  site_url: string;
  username: string;
  password: string;
  notes?: string;
}

// ─── Vault lifecycle ────────────────────────────────────────────────────────

export const createVault = (vaultPath: string, masterPassword: string) =>
  invoke<void>("create_vault", { vaultPath, masterPassword });

export const unlockVault = (vaultPath: string, masterPassword: string) =>
  invoke<void>("unlock_vault", { vaultPath, masterPassword });

export const lockVault = () => invoke<void>("lock_vault");

export const isVaultUnlocked = () => invoke<boolean>("is_vault_unlocked");

// ─── Entries ────────────────────────────────────────────────────────────────

export const listEntries = () => invoke<Entry[]>("list_entries");

export const createEntry = (input: EntryInput) =>
  invoke<Entry>("create_entry", { input });

export const updateEntry = (id: string, input: EntryInput) =>
  invoke<Entry>("update_entry", { id, input });

export const deleteEntry = (id: string) =>
  invoke<void>("delete_entry", { id });

export const getEntryPassword = (id: string) =>
  invoke<string>("get_entry_password", { id });

export const findByHostname = (hostname: string) =>
  invoke<Entry[]>("find_by_hostname", { hostname });
