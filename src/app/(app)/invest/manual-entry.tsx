"use client";
import { useMemo, useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { deletePerformanceMonth, saveManualPerformanceMonth, saveManualPositions } from "./import-actions";
import type { InvestAccount, InvestmentImportView } from "./invest-board";

const fieldClass =
  "mt-1 w-full rounded-md bg-background px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand";
const labelClass = "block text-[10px] font-semibold uppercase tracking-wide text-muted";

const thisMonth = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);
const toNumber = (value: string) => {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

function DestinationFields({
  accounts,
  accountId,
  bucketId,
  onAccount,
  onBucket,
  locked,
}: {
  accounts: InvestAccount[];
  accountId: string;
  bucketId: string;
  onAccount: (value: string) => void;
  onBucket: (value: string) => void;
  locked: boolean;
}) {
  const selected = accounts.find((account) => account.id === accountId);
  if (locked) {
    return (
      <>
        <input type="hidden" name="accountId" value={accountId} />
        <input type="hidden" name="bucketId" value={bucketId} />
      </>
    );
  }
  return (
    <>
      <label className={`${labelClass} min-w-44 flex-1`}>
        Account
        <select name="accountId" value={accountId} onChange={(event) => { onAccount(event.target.value); onBucket(""); }} className={fieldClass}>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>{account.name}{account.isKids ? " · Kids Funding" : ""}</option>
          ))}
        </select>
      </label>
      <label className={`${labelClass} min-w-36 flex-1`}>
        Bucket
        <select name="bucketId" value={bucketId} onChange={(event) => onBucket(event.target.value)} className={fieldClass}>
          <option value="">Account total</option>
          {(selected?.buckets ?? []).map((bucket) => <option key={bucket.id} value={bucket.id}>{bucket.name}</option>)}
        </select>
      </label>
    </>
  );
}

/**
 * One month, typed by hand. Serves both "append September to Fidelity without
 * re-uploading five years" and "Schwab has no export at all" — the server
 * writes into the same ledger the CSV importer maintains either way.
 */
export function AddMonthForm({
  accounts,
  imports,
  currency,
  defaultAccountId,
  defaultBucketId,
  locked = false,
  onDone,
}: {
  accounts: InvestAccount[];
  imports: InvestmentImportView[];
  currency: string;
  defaultAccountId?: string;
  defaultBucketId?: string | null;
  locked?: boolean;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? "");
  const [bucketId, setBucketId] = useState(defaultBucketId ?? "");
  const [month, setMonth] = useState(thisMonth());
  const [ending, setEnding] = useState("");
  const [contributions, setContributions] = useState("");
  const [withdrawals, setWithdrawals] = useState("");
  const [dividends, setDividends] = useState("");
  const [fees, setFees] = useState("");

  const ledger = useMemo(
    () => imports.find(
      (item) => item.importKind === "performance" && item.accountId === accountId && (item.bucketId ?? "") === bucketId,
    ) ?? null,
    [imports, accountId, bucketId],
  );

  // The prior month's ending balance, read from whatever is already on file for
  // this account/bucket — imported or hand-typed, it makes no difference here.
  const beginningCents = useMemo(() => {
    const earlier = (ledger?.performance ?? [])
      .filter((row) => row.asOfDate < `${month}-01`)
      .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate))[0];
    return earlier?.endingBalanceCents ?? null;
  }, [ledger, month]);

  // A month already on file matches on the calendar month, not the exact day:
  // imported Fidelity rows land on the 3rd, a typed one on the 1st.
  const existing = useMemo(
    () => (ledger?.performance ?? []).find((row) => row.asOfDate.slice(0, 7) === month) ?? null,
    [ledger, month],
  );

  const endingCents = Math.round(toNumber(ending) * 100);
  const marketChangeCents = beginningCents == null || !ending
    ? null
    : endingCents
      - beginningCents
      - Math.round(toNumber(contributions) * 100)
      + Math.round(toNumber(withdrawals) * 100)
      - Math.round(toNumber(dividends) * 100)
      + Math.round(toNumber(fees) * 100);

  return (
    <form
      action={(formData) => start(async () => {
        const result = await saveManualPerformanceMonth(formData);
        if (result?.error) setError(result.error);
        else onDone();
      })}
      className="rounded-lg bg-surface p-3 ring-1 ring-line"
    >
      <div className="flex flex-wrap items-end gap-2">
        <DestinationFields accounts={accounts} accountId={accountId} bucketId={bucketId} onAccount={setAccountId} onBucket={setBucketId} locked={locked} />
        <label className={`${labelClass} min-w-32 flex-1`}>
          Month
          <input type="month" name="month" value={month} onChange={(event) => setMonth(event.target.value)} className={fieldClass} />
        </label>
        <label className={`${labelClass} min-w-32 flex-1`}>
          Ending balance
          <input name="endingBalance" value={ending} onChange={(event) => setEnding(event.target.value)} inputMode="decimal" placeholder="21,911.00" autoComplete="off" className={fieldClass} />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className={`${labelClass} min-w-28 flex-1`}>
          Contributions
          <input name="contributions" value={contributions} onChange={(event) => setContributions(event.target.value)} inputMode="decimal" placeholder="0.00" autoComplete="off" className={fieldClass} />
        </label>
        <label className={`${labelClass} min-w-28 flex-1`}>
          Withdrawals
          <input name="withdrawals" value={withdrawals} onChange={(event) => setWithdrawals(event.target.value)} inputMode="decimal" placeholder="0.00" autoComplete="off" className={fieldClass} />
        </label>
        <label className={`${labelClass} min-w-28 flex-1`}>
          Dividends
          <input name="dividends" value={dividends} onChange={(event) => setDividends(event.target.value)} inputMode="decimal" placeholder="0.00" autoComplete="off" className={fieldClass} />
        </label>
        <label className={`${labelClass} min-w-28 flex-1`}>
          Fees
          <input name="fees" value={fees} onChange={(event) => setFees(event.target.value)} inputMode="decimal" placeholder="0.00" autoComplete="off" className={fieldClass} />
        </label>
      </div>

      <p className="mt-2 text-[11px] text-muted">
        {beginningCents == null
          ? "No earlier month on file, so this one starts the history. Market change stays blank until there is a month before it."
          : <>Starts from {formatMoney(beginningCents, currency)}. Market change is worked out for you{marketChangeCents == null ? "." : <>: <span className="font-semibold tabular-nums" style={{ color: marketChangeCents < 0 ? "var(--negative)" : "var(--viz-savings)" }}>{formatMoney(marketChangeCents, currency)}</span></>}</>}
      </p>

      {existing && ledger ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-black/5 px-2 py-1.5 text-[11px] dark:bg-white/10">
          <span className="text-muted">{month} is already on file at {formatMoney(existing.endingBalanceCents, currency)}. Saving replaces it.</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => {
              const payload = new FormData();
              payload.set("batchId", ledger.id);
              payload.set("asOfDate", existing.asOfDate);
              const result = await deletePerformanceMonth(payload);
              if (result?.error) setError(result.error);
              else onDone();
            })}
            className="font-semibold text-negative underline underline-offset-2 disabled:opacity-50"
          >
            Remove this month
          </button>
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50">
          {pending ? "Saving…" : existing ? "Replace month" : "Save month"}
        </button>
        <button type="button" onClick={onDone} className="rounded-md px-2 py-1.5 text-xs font-medium text-muted hover:bg-background">Cancel</button>
        {error ? <span className="w-full text-[11px] text-negative">{error}</span> : null}
      </div>
    </form>
  );
}

type HoldingDraft = { symbol: string; securityName: string; marketValue: string; quantity: string; costBasis: string };
const blankHolding = (): HoldingDraft => ({ symbol: "", securityName: "", marketValue: "", quantity: "", costBasis: "" });

/**
 * Holdings for a brokerage with no export. Deliberately quarterly work, not
 * monthly: allocation drifts slowly, so a handful of symbol/value pairs a few
 * times a year is enough to keep the roll-up honest.
 */
export function AddHoldingsForm({
  accounts,
  currency,
  defaultAccountId,
  defaultBucketId,
  onDone,
}: {
  accounts: InvestAccount[];
  currency: string;
  defaultAccountId?: string;
  defaultBucketId?: string | null;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? "");
  const [bucketId, setBucketId] = useState(defaultBucketId ?? "");
  const [asOfDate, setAsOfDate] = useState(today());
  const [rows, setRows] = useState<HoldingDraft[]>([blankHolding(), blankHolding(), blankHolding()]);

  const update = (index: number, patch: Partial<HoldingDraft>) =>
    setRows((current) => current.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  const filled = rows.filter((row) => row.symbol.trim() || row.securityName.trim());
  const total = filled.reduce((sum, row) => sum + Math.round(toNumber(row.marketValue) * 100), 0);

  return (
    <form
      action={(formData) => start(async () => {
        formData.set("holdings", JSON.stringify(filled));
        const result = await saveManualPositions(formData);
        if (result?.error) setError(result.error);
        else onDone();
      })}
      className="rounded-lg bg-surface p-3 ring-1 ring-line"
    >
      <div className="flex flex-wrap items-end gap-2">
        <DestinationFields accounts={accounts} accountId={accountId} bucketId={bucketId} onAccount={setAccountId} onBucket={setBucketId} locked={false} />
        <label className={`${labelClass} min-w-32 flex-1`}>
          As of
          <input type="date" name="asOfDate" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} className={fieldClass} />
        </label>
      </div>

      <div className="mt-3 space-y-2">
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-2 gap-2 sm:grid-cols-[7rem_1fr_8rem_7rem]">
            <label className={labelClass}>
              Ticker
              <input value={row.symbol} onChange={(event) => update(index, { symbol: event.target.value })} autoComplete="off" className={`${fieldClass} uppercase`} />
            </label>
            <label className={labelClass}>
              Name
              <input value={row.securityName} onChange={(event) => update(index, { securityName: event.target.value })} autoComplete="off" className={fieldClass} />
            </label>
            <label className={labelClass}>
              Value
              <input value={row.marketValue} onChange={(event) => update(index, { marketValue: event.target.value })} inputMode="decimal" placeholder="0.00" autoComplete="off" className={fieldClass} />
            </label>
            <label className={labelClass}>
              Shares
              <input value={row.quantity} onChange={(event) => update(index, { quantity: event.target.value })} inputMode="decimal" autoComplete="off" className={fieldClass} />
            </label>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setRows((current) => [...current, blankHolding()])} className="rounded-md bg-black/5 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20">Add another holding</button>
        <span className="text-[11px] text-muted">{filled.length} holding{filled.length === 1 ? "" : "s"} · {formatMoney(total, currency)}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50">
          {pending ? "Saving…" : "Save holdings"}
        </button>
        <button type="button" onClick={onDone} className="rounded-md px-2 py-1.5 text-xs font-medium text-muted hover:bg-background">Cancel</button>
        {error ? <span className="w-full text-[11px] text-negative">{error}</span> : null}
      </div>
    </form>
  );
}
