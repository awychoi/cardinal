import { describe, expect, it } from "vitest";
import dark from "../assets/brand/cardinal-lockup-dark.svg?raw";
import light from "../assets/brand/cardinal-lockup.svg?raw";

/**
 * The website syncs these files into `public/workbench/logos` and renders them
 * as a plain <img>, so they must stay self-contained: vector paths only, no
 * live text, embedded fonts, scripts, or external references.
 */
const VARIANTS = [
  { name: "dark", svg: dark, ink: "#F4F7FF", beak: "#F4F7FF" },
  { name: "light", svg: light, ink: "#081120", beak: "#202A32" },
] as const;

describe("workbench lockup", () => {
  it.each(VARIANTS)("$name is a self-contained SVG", ({ svg }) => {
    expect(svg).toContain("<svg");
    expect(svg).toContain("Local-first card ledger");
    expect(svg).not.toMatch(/<script\b/i);
    expect(svg).not.toMatch(/<text\b/i);
    expect(svg).not.toMatch(/<foreignObject\b/i);
    expect(svg).not.toMatch(/\b(?:href|src)\s*=/i);
  });

  it.each(VARIANTS)("$name has one cardinal-red i-dot", ({ svg }) => {
    expect(svg.match(/id="wordmark-dot"/g)).toHaveLength(1);
    expect(svg).toMatch(/id="wordmark-dot"[^>]*fill="#C83C43"/);
  });

  it.each(VARIANTS)("$name picks ink and beak for its surface", ({ svg, ink, beak }) => {
    expect(svg).toContain(`id="wordmark" fill="${ink}"`);
    expect(svg).toContain(`fill="${beak}" d="M644 289L829 362L644 428Z"`);
    expect(svg).toContain('width="295.83" height="90"');
  });

  it("ships different files for dark and light surfaces", () => {
    expect(dark).not.toBe(light);
    expect(dark).not.toContain('id="wordmark" fill="#081120"');
    expect(light).not.toContain('id="wordmark" fill="#F4F7FF"');
  });
});
