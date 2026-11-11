import { describe, expect, it } from "vitest";
import { BRAND_MARKS, brandMarkFor } from "./logos";

describe("brand marks", () => {
  it("ships one mark per resolved mode", () => {
    expect(Object.keys(BRAND_MARKS).sort()).toEqual(["dark", "light"]);
    expect(new Set(Object.values(BRAND_MARKS)).size).toBe(2);
  });

  it("resolves each mode to its own mark", () => {
    expect(brandMarkFor("light")).toBe(BRAND_MARKS.light);
    expect(brandMarkFor("dark")).toBe(BRAND_MARKS.dark);
  });

  it("falls back to the dark mark for a missing mode", () => {
    expect(brandMarkFor(undefined)).toBe(BRAND_MARKS.dark);
    expect(brandMarkFor(null)).toBe(BRAND_MARKS.dark);
  });
});
