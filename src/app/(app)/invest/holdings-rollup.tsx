"use client";
import { useMemo, useState, useTransition } from "react";
import { formatMoney, centsToGroupedDisplay } from "@/lib/money";
import { ModalShell } from "@/components/modal-shell";
import { deleteHolding, saveHolding } from "./import-actions";
import { ledgerLabel } from "./invest-board";
import type { InvestAccount, InvestmentImportView, InvestmentPositionImportRow } from "./invest-board";

type HoldingRow = InvestmentPositionImportRow & { accountLabel: string; accountId: string; bucketId: string | null };

const gainTone = (value: number) => (value > 0 ? "text-positive" : value < 0 ? "text-negative" : "text-foreground");
const fieldClass =
  "mt-1 w-full rounded-md bg-background px-2 py-1.5 text-sm text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand";
const labelClass = "block text-[10px] font-semibold uppercase tracking-wide text-muted";

/**
 * Edit one holding. Everything about it is typed here rather than in the table
 * so the row stays a stable thing to read — and so a holding is saved once,
 * whole, instead of a figure at a time.
 */
function HoldingModal({
  holding,
  accounts,
  onClose,
}: {
  holding: HoldingRow;
  accounts: InvestAccount[];
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [destination, setDestination] = useState(`${holding.accountId}:${holding.bucketId ?? ""}`);
  const [url, setUrl] = useState(holding.url ?? "");

  // The link follows what is typed, so it works before the form is saved. Only
  // http(s) opens — anything else would be a script URL wearing a link's coat.
  const openableUrl = (() => {
    const trimmed = url.trim();
    if (!trimmed) return null;
    try {
      const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
    } catch {
      return null;
    }
  })();

  // Two accounts are both called "Fidelity" — one is Kids Funding — so the
  // label has to carry that or the two are indistinguishable in the list.
  const options = accounts.flatMap((account) => {
    const name = `${account.name}${account.isKids ? " (Kids)" : ""}`;
    return [
      { value: `${account.id}:`, label: account.buckets.length > 0 ? `${name} · Account total` : name },
      ...account.buckets.map((bucket) => ({ value: `${account.id}:${bucket.id}`, label: `${name} · ${bucket.name}` })),
    ];
  });

  return (
    <ModalShell title={holding.symbol ?? holding.securityName} onClose={onClose} mobileAlign="top" className="sm:!max-w-2xl">
      <form
        action={(formData) => start(async () => {
          const [accountId, bucketId] = destination.split(":");
          formData.set("positionId", holding.id);
          formData.set("accountId", accountId);
          formData.set("bucketId", bucketId ?? "");
          const result = await saveHolding(formData);
          if (result?.error) setError(result.error);
          else onClose();
        })}
        className="px-5 py-4"
      >
        {/* Three by three: a ticker is about five characters, so it takes the
            narrow column and the fields that need room get the wider ones. */}
        <div className="grid gap-x-3 gap-y-3 sm:grid-cols-[0.7fr_1.3fr_1.2fr]">
          <label className={labelClass}>
            Ticker
            <input name="ticker" defaultValue={holding.symbol ?? ""} autoComplete="off" className={`${fieldClass} uppercase`} />
          </label>
          <label className={labelClass}>
            Name
            <input name="securityName" defaultValue={holding.securityName} autoComplete="off" className={fieldClass} />
          </label>
          <label className={labelClass}>
            Account
            <select value={destination} onChange={(event) => setDestination(event.target.value)} className={fieldClass}>
              {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          <label className={labelClass}>
            Shares
            <input name="quantity" defaultValue={holding.quantity == null ? "" : String(holding.quantity)} inputMode="decimal" autoComplete="off" className={fieldClass} />
          </label>
          <label className={labelClass}>
            Current value
            <input name="marketValue" defaultValue={centsToGroupedDisplay(holding.marketValueCents)} inputMode="decimal" autoComplete="off" className={fieldClass} />
          </label>
          <label className={labelClass}>
            Cost basis
            <input name="costBasis" defaultValue={holding.costBasisCents == null ? "" : centsToGroupedDisplay(holding.costBasisCents)} inputMode="decimal" autoComplete="off" className={fieldClass} />
          </label>

          <label className={labelClass}>
            Gain/loss
            <input name="gain" defaultValue={holding.unrealizedGainCents == null ? "" : centsToGroupedDisplay(holding.unrealizedGainCents)} inputMode="decimal" autoComplete="off" className={fieldClass} />
          </label>
          <label className={labelClass}>
            Gain/loss %
            <input name="gainPercent" defaultValue={holding.unrealizedGainPercent == null ? "" : String(holding.unrealizedGainPercent)} inputMode="decimal" autoComplete="off" className={fieldClass} />
          </label>
          <div className={labelClass}>
            <span className="flex items-center justify-between gap-2">
              Website
              {openableUrl ? (
                <a
                  href={openableUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold normal-case tracking-normal text-brand hover:underline"
                >
                  Open ↗
                </a>
              ) : null}
            </span>
            {/* Deliberately not type="url": the browser would reject a bare
                domain, but the server accepts one and adds https:// for you. */}
            <input
              name="url"
              type="text"
              inputMode="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="fidelity.com/…"
              autoComplete="off"
              className={`${fieldClass} normal-case`}
            />
          </div>
        </div>

        {error ? <p className="mt-3 text-xs text-negative">{error}</p> : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          {confirmingDelete ? (
            <span className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted">Remove this holding?</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => start(async () => {
                  const payload = new FormData();
                  payload.set("positionId", holding.id);
                  const result = await deleteHolding(payload);
                  if (result?.error) setError(result.error);
                  else onClose();
                })}
                className="rounded-md bg-negative px-3 py-1.5 font-semibold text-white disabled:opacity-50"
              >
                Remove
              </button>
              <button type="button" onClick={() => setConfirmingDelete(false)} className="px-2 py-1.5 font-medium text-muted hover:text-foreground">Keep</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmingDelete(true)} className="text-xs font-semibold text-negative hover:underline">Remove holding</button>
          )}
          <span className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-xs font-medium text-muted hover:bg-background">Cancel</button>
            <button type="submit" disabled={pending} className="rounded-md bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50">
              {pending ? "Saving…" : "Save holding"}
            </button>
          </span>
        </div>
      </form>
    </ModalShell>
  );
}

/**
 * Every holding, from every brokerage, in one table.
 *
 * Holdings deliberately are NOT grouped per account: what is held is one list,
 * and which account holds it is a column on that list — so a new brokerage
 * adds rows rather than another panel. The table is read-only; a row opens the
 * form that edits it.
 */
export function AllHoldingsTable({
  imports,
  accounts,
  currency,
}: {
  imports: InvestmentImportView[];
  accounts: InvestAccount[];
  currency: string;
}) {
  const [accountFilter, setAccountFilter] = useState("");
  const [editing, setEditing] = useState<HoldingRow | null>(null);

  // Only the latest snapshot of each ledger counts — a positions ledger keeps
  // every date it was given, and older dates are history, not extra holdings.
  const rows = useMemo(() => {
    const all: HoldingRow[] = [];
    for (const ledger of imports) {
      if (ledger.importKind !== "positions" || ledger.positions.length === 0) continue;
      const latest = ledger.positions.reduce((max, row) => (row.asOfDate > max ? row.asOfDate : max), ledger.positions[0].asOfDate);
      const accountLabel = ledgerLabel(ledger.accountName, ledger.bucketName);
      for (const row of ledger.positions) {
        if (row.asOfDate === latest) all.push({ ...row, accountLabel, accountId: ledger.accountId, bucketId: ledger.bucketId });
      }
    }
    return all.sort((a, b) => b.marketValueCents - a.marketValueCents);
  }, [imports]);

  const accountLabels = useMemo(() => [...new Set(rows.map((row) => row.accountLabel))].sort(), [rows]);
  const visible = accountFilter ? rows.filter((row) => row.accountLabel === accountFilter) : rows;
  const totalCents = visible.reduce((sum, row) => sum + row.marketValueCents, 0);

  if (rows.length === 0) {
    return (
      <p className="px-4 py-5 text-sm text-muted">
        No holdings yet. Use <span className="font-medium text-foreground">Add holdings</span> to type them in, or import a positions CSV.
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Select a row to edit it</span>
          {accountLabels.length > 1 ? (
            <select
              value={accountFilter}
              onChange={(event) => setAccountFilter(event.target.value)}
              className="rounded-md bg-background px-2 py-1.5 text-xs text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">All accounts</option>
              {accountLabels.map((label) => <option key={label} value={label}>{label}</option>)}
            </select>
          ) : null}
        </div>
        <span className="ml-auto text-base font-bold tabular-nums">
          {visible.length} holding{visible.length === 1 ? "" : "s"} · {formatMoney(totalCents, currency)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-background/50 text-[10px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 text-center">Ticker</th>
              <th className="px-3 py-2 text-center">Account</th>
              <th className="px-3 py-2 text-center">Shares</th>
              <th className="px-3 py-2 text-center">Current value</th>
              <th className="px-3 py-2 text-center">Cost basis</th>
              <th className="px-3 py-2 text-center">Gain/loss</th>
              <th className="px-3 py-2 text-center">Gain/loss %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visible.map((row) => (
              <tr
                key={row.id}
                onClick={() => setEditing(row)}
                className="cursor-pointer transition hover:bg-brand-soft/25"
              >
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    <span className="font-semibold">{row.symbol ?? row.securityName}</span>
                    {row.url ? (
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="text-muted transition hover:text-foreground"
                        aria-label={`Open ${row.symbol ?? row.securityName} at the brokerage`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <path d="M15 3h6v6" />
                          <path d="M10 14 21 3" />
                        </svg>
                      </a>
                    ) : null}
                  </span>
                  <span className="block max-w-56 truncate text-[11px] text-muted">{row.securityName}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-center text-[11px] text-muted">{row.accountLabel}</td>
                <td className="px-3 py-2 text-center tabular-nums">{row.quantity ?? "—"}</td>
                <td className="px-3 py-2 text-center font-medium tabular-nums">{formatMoney(row.marketValueCents, currency)}</td>
                <td className="px-3 py-2 text-center tabular-nums">{row.costBasisCents == null ? "—" : formatMoney(row.costBasisCents, currency)}</td>
                <td className={`px-3 py-2 text-center tabular-nums ${gainTone(row.unrealizedGainCents ?? 0)}`}>{row.unrealizedGainCents == null ? "—" : formatMoney(row.unrealizedGainCents, currency)}</td>
                <td className={`px-3 py-2 text-center tabular-nums ${gainTone(row.unrealizedGainPercent ?? 0)}`}>{row.unrealizedGainPercent == null ? "—" : `${row.unrealizedGainPercent.toFixed(2)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing ? <HoldingModal holding={editing} accounts={accounts} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
