import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Component tests exercise the browser mock bridge, never the native IPC.
vi.stubEnv("VITE_MOCK_BRIDGE", "1");

// jsdom does not implement scrolling. Stub both entry points so focus and
// reduced-motion code paths run without printing "Not implemented" noise.
// Node-environment suites share this setup file and have no DOM to patch.
if (typeof window !== "undefined" && typeof HTMLElement !== "undefined") {
  window.scrollTo = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
}
