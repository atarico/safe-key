import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// `globals` is disabled in the Vitest config, so React Testing Library does
// not clean up the DOM between tests automatically. Do it explicitly.
afterEach(() => {
  cleanup();
});
