import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountForm } from "./AccountForm";

function renderForm() {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<AccountForm submitLabel="Add account" onSubmit={onSubmit} />);
  return { onSubmit };
}

describe("AccountForm validation", () => {
  it("shows human field errors, a summary, and focuses the first invalid field", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.click(screen.getByRole("button", { name: "Add account" }));

    expect(onSubmit).not.toHaveBeenCalled();
    const summary = screen.getByRole("alert");
    expect(summary).toHaveTextContent("Check these 2 fields before saving.");
    expect(summary).toHaveTextContent("Enter the issuer, for example Chase.");
    expect(summary).toHaveTextContent("Enter a display name, for example Sapphire Reserve.");
    expect(summary).not.toHaveTextContent(/Too small|expected string/i);

    const issuer = screen.getByLabelText("Issuer");
    const displayName = screen.getByLabelText("Display name");
    expect(issuer).toHaveAttribute("required");
    expect(displayName).toHaveAttribute("required");
    expect(issuer).toHaveAttribute("aria-invalid", "true");
    expect(issuer).toHaveAttribute("aria-describedby", "account-issuer-error");
    expect(document.getElementById("account-issuer-error")).toHaveTextContent(
      "Enter the issuer, for example Chase.",
    );
    await waitFor(() => expect(issuer).toHaveFocus());
  });

  it("moves focus to the first remaining invalid field and clears resolved errors", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: "Add account" }));
    const issuer = screen.getByLabelText("Issuer");
    await waitFor(() => expect(issuer).toHaveFocus());

    await user.type(issuer, "Chase");
    expect(screen.queryByText("Enter the issuer, for example Chase.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add account" }));

    const displayName = screen.getByLabelText("Display name");
    await waitFor(() => expect(displayName).toHaveFocus());
    expect(screen.getByRole("alert")).toHaveTextContent("Check this field before saving.");
    expect(issuer).toHaveAttribute("aria-invalid", "false");
    expect(issuer).not.toHaveAttribute("aria-describedby");
  });

  it("keeps four-digit validation with a specific message and describedby wiring", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Issuer"), "Chase");
    await user.type(screen.getByLabelText("Display name"), "Sapphire Reserve");
    await user.type(screen.getByLabelText("Last four digits (optional)"), "12");
    await user.click(screen.getByRole("button", { name: "Add account" }));

    const lastFour = screen.getByLabelText("Last four digits (optional)");
    expect(lastFour).toHaveAttribute("aria-invalid", "true");
    expect(lastFour).toHaveAttribute("aria-describedby", "account-last-four-error");
    expect(document.getElementById("account-last-four-error")).toHaveTextContent(
      "Enter exactly four digits, or leave it blank.",
    );
    await waitFor(() => expect(lastFour).toHaveFocus());
  });

  it("submits a valid payload", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.type(screen.getByLabelText("Issuer"), "Chase");
    await user.type(screen.getByLabelText("Display name"), "Sapphire Reserve");
    await user.type(screen.getByLabelText("Last four digits (optional)"), "1234");
    await user.click(screen.getByRole("button", { name: "Add account" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      issuer: "Chase",
      displayName: "Sapphire Reserve",
      lastFour: "1234",
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
