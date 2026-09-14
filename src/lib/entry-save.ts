import { getEntryPassword } from "./tauri";
import type { EntryInput } from "./tauri";
import type { EntryFormValues } from "../components/EntryForm";

/**
 * Turns what the form reported into what the vault stores. A null password
 * means the user left the field alone, so the stored one is carried over
 * unchanged; any string the user typed is kept verbatim.
 */
export async function toEntryInput(
  values: EntryFormValues,
  entryId: string
): Promise<EntryInput> {
  return {
    ...values,
    password: values.password ?? (await getEntryPassword(entryId)),
  };
}
