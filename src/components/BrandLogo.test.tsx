import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BRAND_MARKS } from "../brand/logos";
import { BrandLogo } from "./BrandLogo";

describe("BrandLogo", () => {
  it("uses the mark for the resolved mode", () => {
    const light = render(<BrandLogo mode="light" />);
    expect(light.container.querySelector("img")).toHaveAttribute("src", BRAND_MARKS.light);

    const dark = render(<BrandLogo mode="dark" />);
    expect(dark.container.querySelector("img")).toHaveAttribute("src", BRAND_MARKS.dark);
  });

  it("labels the lockup once and exposes the mode for styling", () => {
    const { container } = render(<BrandLogo mode="dark" className="boot-logo" />);
    expect(screen.getByRole("img", { name: "Cardinal" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("boot-logo");
    expect(container.firstElementChild).toHaveAttribute("data-brand-mode", "dark");
    expect(container).toHaveTextContent("cardinal");
    expect(container).toHaveTextContent(/Local-first Card Ledger/i);
  });

  it("can be decorative where a heading already names the app", () => {
    const { container } = render(<BrandLogo mode="light" alt="" />);
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    expect(container.firstElementChild).not.toHaveAttribute("role");
  });
});
