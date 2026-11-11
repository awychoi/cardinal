import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { __resetMockBridge, __setMockSettings, __setMockVaultState } from "../mocks/bridge";

async function unlock() {
  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByText(/Your encrypted ledger is locked/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Unlock vault" }));
  expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
  return user;
}

describe("app shell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetMockBridge();
    __setMockSettings({ onboardingCompleted: true });
    __setMockVaultState({ vaultExists: true, unlocked: false });
  });

  it("starts locked with no password input and a native-sheet explanation", async () => {
    render(<App />);
    expect(await screen.findByText(/Your encrypted ledger is locked/)).toBeInTheDocument();
    expect(document.querySelector("input[type='password']")).toBeNull();
    expect(screen.getByText(/native macOS sheet/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Cardinal" })).toBeInTheDocument();
  });

  it("offers vault creation when no vault exists", async () => {
    __setMockVaultState({ vaultExists: false, unlocked: false });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText(/Create your encrypted ledger/)).toBeInTheDocument();
    expect(screen.getByText(/no recovery if you lose it/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Create vault/ }));
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
  });

  it("unlocks through the typed bridge and shows the secure shell", async () => {
    await unlock();
    expect(screen.getByText(/No provider connected/)).toBeInTheDocument();
    expect(screen.getByText(/Mock desktop bridge/)).toBeInTheDocument();
  });

  it("locks again and clears the unlocked view", async () => {
    const user = await unlock();
    await user.click(screen.getByRole("button", { name: "Lock now" }));
    expect(await screen.findByText(/Your encrypted ledger is locked/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Overview" })).not.toBeInTheDocument();
  });

  it("stores only the non-sensitive theme id in browser storage", async () => {
    await unlock();
    await waitFor(() => expect(window.localStorage.getItem("cardinal.theme")).toBe("blueprint"));
    expect(Object.keys(window.localStorage)).toEqual(["cardinal.theme"]);
    expect(Object.keys(window.sessionStorage)).toEqual([]);
    expect(window.location.href).not.toMatch(/passphrase|token|secret/i);
  });

  it("uses the remembered theme before the vault is unlocked", async () => {
    window.localStorage.setItem("cardinal.theme", "arcade");
    render(<App />);
    expect(await screen.findByText(/Your encrypted ledger is locked/)).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.dataset.skin).toBe("arcade"));
  });

  it("persists a theme selected in encrypted settings", async () => {
    __setMockSettings({ themeId: "arcade", onboardingCompleted: true });
    await unlock();
    await waitFor(() => expect(window.localStorage.getItem("cardinal.theme")).toBe("arcade"));
  });

  it("toggles appearance through encrypted settings", async () => {
    const user = await unlock();
    const toggle = screen.getByRole("button", { name: /appearance/i });
    await user.click(toggle);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    expect(Object.keys(window.localStorage)).toEqual(["cardinal.theme"]);
  });

  it("walks the onboarding wizard by skipping every optional step", async () => {
    __setMockSettings({ onboardingCompleted: false });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Unlock vault" }));
    expect(await screen.findByText("Connect your bank.")).toBeInTheDocument();
    expect(screen.getByText(/macOS Keychain/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue without a bank" }));
    expect(await screen.findByText("Set your reporting timezone.")).toBeInTheDocument();
    expect(screen.getByText(/Detected from this Mac/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("You are ready.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
  });

  it("adds an account through the onboarding wizard", async () => {
    __setMockSettings({ onboardingCompleted: false });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Unlock vault" }));
    await screen.findByText("Connect your bank.");
    await user.click(screen.getByRole("button", { name: "Add a card manually" }));
    expect(await screen.findByText("Add a card manually.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Issuer"), "Chase");
    await user.type(screen.getByLabelText("Display name"), "Wizard Card");
    await user.type(screen.getByLabelText(/Last four/), "1234");
    await user.click(screen.getByRole("button", { name: "Add account" }));
    expect(await screen.findByText("Set your reporting timezone.")).toBeInTheDocument();
    expect(screen.getByText(/Added Wizard Card/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Finish setup" }));
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Accounts" }));
    expect((await screen.findAllByText("Wizard Card", { exact: true })).length).toBeGreaterThan(0);
  });

  it("saves Plaid credentials through the onboarding credential step", async () => {
    __setMockSettings({ onboardingCompleted: false });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Unlock vault" }));
    await screen.findByText("Connect your bank.");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Add Sandbox credentials/ })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: /Add Sandbox credentials/ }));
    expect(
      await screen.findByText(/Sandbox credentials saved to the macOS Keychain/),
    ).toBeInTheDocument();
    expect(screen.getByText("Stored in Keychain")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Set your reporting timezone.");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/Sandbox credentials \(Keychain\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
  });

  it("shows real cipher, KDF, and security events in settings", async () => {
    const user = await unlock();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "About" }));
    expect(await screen.findByText("SQLCipher")).toBeInTheDocument();
    expect(screen.getAllByText(/4\.6\.1 community/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Argon2id/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Security events" }));
    expect((await screen.findAllByText(/unlock success/i)).length).toBeGreaterThan(0);
    expect(document.querySelector("input[type='password']")).toBeNull();
    expect(document.body.textContent ?? "").not.toContain("correct horse");
    expect(document.body.textContent ?? "").not.toContain("sentinel");
  });
});
