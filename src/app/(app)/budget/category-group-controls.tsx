"use client";

import { useState, useTransition } from "react";
import { ModalShell } from "@/components/modal-shell";
import { addCategoryGroup } from "./actions";

const GROUP_TYPES = [
  { value: "income", label: "Income" },
  { value: "bills", label: "Bills" },
  { value: "expenses", label: "Expenses" },
  { value: "savings", label: "Savings" },
] as const;

export function AddCategoryGroupButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-1 text-[13px] font-semibold text-foreground transition hover:bg-foreground/8 dark:hover:bg-white/10 sm:px-2.5 sm:text-xs"
      >
        <span aria-hidden>+</span>
        Cat Group
      </button>
      {open ? <AddCategoryGroupModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AddCategoryGroupModal({ onClose }: { onClose: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <ModalShell title="Create category group" onClose={onClose} className="sm:!max-w-[420px]">
      <form
        action={(formData) =>
          start(async () => {
            setError(null);
            const result = await addCategoryGroup(formData);
            if (result.error) setError(result.error);
            else onClose();
          })
        }
        className="space-y-4 p-5"
      >
        <p className="text-sm text-muted">
          Create a separate section while keeping its totals under Income, Bills, Expenses, or Savings.
        </p>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">Group name</span>
          <input
            name="name"
            required
            autoFocus
            placeholder="Home Bills"
            className="rounded-xl bg-background px-3 py-2.5 ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">Annual overview type</span>
          <select
            name="kind"
            defaultValue="bills"
            className="rounded-xl bg-background px-3 py-2.5 ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {GROUP_TYPES.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </label>
        {error ? <p className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-brand-soft">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
            {pending ? "Creating…" : "Create group"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
