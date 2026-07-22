"use client";

import { useState, useTransition } from "react";
import { ModalShell } from "@/components/modal-shell";
import { addSubcategoriesBulk } from "./actions";
import type { GroupData } from "./types";

export function BulkAddSubcategories({ groups }: { groups: GroupData[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg px-2.5 py-1 text-xs font-semibold text-brand transition hover:bg-brand-soft"
      >
        + Bulk add items
      </button>
      {open ? <BulkAddModal groups={groups} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function BulkAddModal({ groups, onClose }: { groups: GroupData[]; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [categoryId, setCategoryId] = useState(groups[0]?.categoryId ?? "");
  const [names, setNames] = useState("");
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);

  return (
    <ModalShell title="Bulk add budget items" onClose={onClose}>
      <form
        action={(fd) =>
          start(async () => {
            const res = await addSubcategoriesBulk(fd);
            setResult(res);
            setNames("");
          })
        }
        className="space-y-4 p-5"
      >
        <p className="text-sm text-muted">
          Paste one item name per line — they&rsquo;ll all be added to the category you pick below.
          Existing names (case-insensitive) are skipped automatically.
        </p>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">Category</span>
          <select
            name="categoryId"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="rounded-xl bg-background px-3 py-2.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {groups.map((g) => (
              <option key={g.categoryId} value={g.categoryId}>{g.name}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">Item names</span>
          <textarea
            name="names"
            required
            rows={8}
            value={names}
            onChange={(e) => setNames(e.target.value)}
            placeholder={"Tithes\nInternet\nMobile\nSales Taxes"}
            className="rounded-xl bg-background px-3 py-2.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </label>

        {result ? (
          <p className="text-sm font-medium text-positive">
            Added {result.added}{result.skipped > 0 ? `, skipped ${result.skipped} duplicate${result.skipped === 1 ? "" : "s"}` : ""}.
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-bold text-brand transition hover:bg-brand-soft hover:text-brand-strong"
          >
            Done
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? "Adding…" : "Add items"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
