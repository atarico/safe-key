// ─── Native Host Messages ────────────────────────────────────────────────────

export type NativeRequest =
  | { action: "get_status" }
  | { action: "unlock"; password: string }
  | { action: "lock" }
  | { action: "find_credentials"; hostname: string }
  | { action: "get_password"; id: string }
  | { action: "save_credential"; site_url: string; username: string; password: string };

export interface NativeResponseOk<T = unknown> {
  status: "ok";
  data?: T;
}

export interface NativeResponseLocked {
  status: "locked";
  message: string;
}

export interface NativeResponseError {
  status: "error";
  message: string;
}

export type NativeResponse<T = unknown> =
  | NativeResponseOk<T>
  | NativeResponseLocked
  | NativeResponseError;

export interface VaultStatus {
  unlocked: boolean;
  vault_configured: boolean;
}

export interface Entry {
  id: string;
  site_url: string;
  username: string;
  password?: string;
  notes?: string;
  created_at: number;
  updated_at: number;
}

// ─── Extension Internal Messages (content ↔ background) ─────────────────────

export type ExtMessage =
  | { type: "GET_CREDENTIALS_FOR_PAGE"; hostname: string }
  | { type: "GET_STATUS" }
  | { type: "UNLOCK"; password: string }
  | { type: "LOCK" }
  | { type: "FILL_FORM"; username: string; password: string }
  | { type: "SAVE_CREDENTIAL"; site_url: string; username: string; password: string }
  | { type: "COPY_PASSWORD"; id: string };

export type ExtResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string; locked?: boolean };
