import { useState, useCallback } from "react";
import * as api from "../lib/tauri";
import type { Entry, EntryInput } from "../lib/tauri";

export type VaultStatus = "locked" | "unlocked" | "no_vault";

export function useVault() {
  const [status, setStatus] = useState<VaultStatus>("locked");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const clearError = () => setError(null);

  const createVault = useCallback(async (vaultPath: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      await api.createVault(vaultPath, password);
      setStatus("unlocked");
      setEntries([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const unlock = useCallback(async (vaultPath: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      await api.unlockVault(vaultPath, password);
      setStatus("unlocked");
      const list = await api.listEntries();
      setEntries(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const lock = useCallback(async () => {
    await api.lockVault();
    setStatus("locked");
    setEntries([]);
  }, []);

  const refreshEntries = useCallback(async () => {
    const list = await api.listEntries();
    setEntries(list);
  }, []);

  const addEntry = useCallback(async (input: EntryInput) => {
    setError(null);
    try {
      await api.createEntry(input);
      await refreshEntries();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }, [refreshEntries]);

  const editEntry = useCallback(async (id: string, input: EntryInput) => {
    setError(null);
    try {
      await api.updateEntry(id, input);
      await refreshEntries();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }, [refreshEntries]);

  const removeEntry = useCallback(async (id: string) => {
    setError(null);
    try {
      await api.deleteEntry(id);
      setEntries(prev => prev.filter(e => e.id !== id));
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }, []);

  const copyPassword = useCallback(async (id: string) => {
    try {
      const pwd = await api.getEntryPassword(id);
      await navigator.clipboard.writeText(pwd);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }, []);

  return {
    status,
    entries,
    error,
    loading,
    clearError,
    createVault,
    unlock,
    lock,
    addEntry,
    editEntry,
    removeEntry,
    copyPassword,
    refreshEntries,
  };
}
