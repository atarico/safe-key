import { beforeEach, describe, expect, it, vi } from "vitest";
import { toEntryInput } from "./entry-save";
import * as api from "./tauri";

vi.mock("./tauri", () => ({ getEntryPassword: vi.fn() }));

const values = { site_url: "github.com", username: "ada", notes: undefined };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("toEntryInput", () => {
  it("carries the stored password over when the user left the field alone", async () => {
    vi.mocked(api.getEntryPassword).mockResolvedValue("stored");

    const input = await toEntryInput({ ...values, password: null }, "entry-1");

    expect(input).toEqual({ ...values, password: "stored" });
    expect(api.getEntryPassword).toHaveBeenCalledWith("entry-1");
  });

  it("keeps a typed password verbatim, sentinel-looking or not", async () => {
    const input = await toEntryInput({ ...values, password: "__KEEP__" }, "e1");

    expect(input).toEqual({ ...values, password: "__KEEP__" });
    expect(api.getEntryPassword).not.toHaveBeenCalled();
  });
});
