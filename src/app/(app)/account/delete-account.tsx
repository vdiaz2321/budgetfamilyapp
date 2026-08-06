"use client";

import { useEffect, useState } from "react";
import { deleteMyAccount } from "./actions";

type Props = {
  soloOwner: boolean;
};

export function DeleteAccountButton({ soloOwner }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-negative bg-negative px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90"
      >
        Delete my account
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl ring-1 ring-line">
            <h3 className="text-lg font-semibold text-foreground">Delete account?</h3>
            <p className="mt-2 text-sm text-muted">
              {soloOwner ? (
                <>
                  You&apos;re the only member of this household, so{" "}
                  <strong className="text-foreground">everything</strong> — accounts,
                  transactions, budgets, savings, debts — will be permanently deleted.
                  This cannot be undone.
                </>
              ) : (
                <>
                  Your profile will be removed from this household. Other members
                  keep the shared budget, accounts, and transactions. Your login
                  will be deleted so this email can be reused later.
                </>
              )}
            </p>

            <form action={deleteMyAccount} className="mt-5 space-y-3">
              <div>
                <label
                  htmlFor="deleteConfirm"
                  className="block text-sm font-medium text-foreground"
                >
                  Type <span className="font-mono">DELETE</span> to confirm
                </label>
                <input
                  id="deleteConfirm"
                  name="confirm"
                  type="text"
                  required
                  autoFocus
                  autoComplete="off"
                  className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm font-mono text-foreground focus:border-negative focus:outline-none focus:ring-1 focus:ring-negative"
                />
              </div>

              <div>
                <label
                  htmlFor="deletePassword"
                  className="block text-sm font-medium text-foreground"
                >
                  Current password
                </label>
                <input
                  id="deletePassword"
                  name="currentPassword"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm text-foreground focus:border-negative focus:outline-none focus:ring-1 focus:ring-negative"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-background"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-negative px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
                >
                  {soloOwner ? "Delete everything" : "Leave & delete login"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
