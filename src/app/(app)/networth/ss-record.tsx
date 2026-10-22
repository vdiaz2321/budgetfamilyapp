"use client";

// The Social Security earnings record on the plan form (Victor, 2026-10-22):
// read the SSA statement once, then add a year at a time — the Invest page's
// import + "Add month" pattern. The statement is read on this device; only
// its numbers go to the server (lib/ssa-statement-pdf, lib/ssa-statement).

import { Fragment, useMemo, useState, useTransition } from "react";
import { ModalShell } from "@/components/modal-shell";
import { displayToCents, formatMoneyWhole } from "@/lib/money";
import {
  benefitAtStartCents,
  recordRetirementPiaCents,
  spousalFactor,
  statementCheck,
  type SsRecord,
  type SsStatementFigures,
} from "@/lib/ssa";
import { earningsByYear, parseSsaStatementText, type SsStatement } from "@/lib/ssa-statement";
import { clearSsRecord, deleteSsYear, importSsStatement, saveSsYear } from "./actions";

const box = "rounded-md bg-surface px-2 py-1.5 text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand";
const label = "block max-sm:text-[12px] sm:text-sm font-bold uppercase tracking-wide text-foreground";
const chip = "rounded-md px-3 py-1.5 text-sm font-semibold text-foreground ring-1 ring-line transition hover:bg-sky-100 hover:ring-sky-400 dark:hover:bg-sky-950/40";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The first month a claim at `age` can be paid: at 62, the month after the birthday. */
function claimStart(birthYear: number, birthMonth: number, age: number): [number, number] {
  if (age !== 62) return [birthYear + age, birthMonth];
  return birthMonth === 12 ? [birthYear + 63, 1] : [birthYear + 62, birthMonth + 1];
}

export function SsRecordSection({
  record,
  birthYear,
  spouseBirthYear,
  spouseClaimAge,
  thisYear,
  currency,
}: {
  record: SsRecord | null;
  birthYear: number | null;
  spouseBirthYear: number | null;
  spouseClaimAge: number | null;
  thisYear: number;
  currency: string;
}) {
  const [importing, setImporting] = useState(false);
  const [year, setYear] = useState("");
  const [amount, setAmount] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [adding, setAdding] = useState(false);
  const [why, setWhy] = useState(false);
  const [claimAge, setClaimAge] = useState(spouseClaimAge == null ? "" : String(spouseClaimAge));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const money = (c: number) => formatMoneyWhole(c, currency);
  const birthMonth = record?.birthMonth ?? 1;

  // His benefit at 62, 67 and 70 from the record as it stands.
  const atAge = useMemo(() => {
    if (!record || birthYear == null) return null;
    return [62, 67, 70].map((age) => {
      const [y, m] = claimStart(birthYear, birthMonth, age);
      const pia = recordRetirementPiaCents(record, birthYear, y, thisYear);
      return { age, cents: benefitAtStartCents(pia, birthYear, birthMonth, y, m) };
    });
  }, [record, birthYear, birthMonth, thisYear]);

  // The calculator on the statement's own assumptions: does it land on the statement?
  const check = useMemo(() => {
    if (!record?.statement || birthYear == null) return null;
    const c = statementCheck(record, birthYear);
    if (!c) return null;
    const off = Object.entries(record.statement.retirementByAge).reduce(
      (worst, [age, cents]) => Math.max(worst, Math.abs((c.retirementByAge[age] ?? 0) - cents)),
      0,
    );
    return { off };
  }, [record, birthYear]);

  const spousal = useMemo(() => {
    const age = Number(claimAge);
    if (!record || birthYear == null || spouseBirthYear == null || !age) return null;
    const [y] = claimStart(birthYear, birthMonth, 67);
    const pia = recordRetirementPiaCents(record, birthYear, y, thisYear);
    const early = Math.max(0, (67 - age) * 12);
    return Math.floor((pia / 200) * spousalFactor(early) + 1e-7) * 100;
  }, [record, birthYear, birthMonth, spouseBirthYear, claimAge, thisYear]);

  const saveEdit = () => {
    if (editing == null || !editAmount.trim()) return;
    const fd = new FormData();
    fd.set("year", String(editing));
    fd.set("earnings", editAmount.trim());
    run(() => saveSsYear(fd), () => setEditing(null));
  };

  const run = (fn: () => Promise<{ error: string | null }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setError(r.error);
      if (!r.error) after?.();
    });

  const saveYear = () => {
    const fd = new FormData();
    fd.set("year", year.trim());
    fd.set("earnings", amount.trim());
    run(() => saveSsYear(fd), () => {
      setYear("");
      setAmount("");
      setAdding(false);
    });
  };

  const rows = record?.earnings ?? [];
  // Only years that have happened; a year gets added once it's over.
  const past = rows.filter((r) => r.year < thisYear);
  const per = Math.ceil(past.length / 3);
  const thirds = [past.slice(0, per), past.slice(per, per * 2), past.slice(per * 2)];
  const posted = past.reduce((t, r) => t + r.cents, 0);
  const spouseOk = spouseBirthYear != null && record != null;
  const yearOk = /^\d{4}$/.test(year.trim()) && Number(year) < thisYear;
  const openAdd = () => {
    const next = (past.at(-1)?.year ?? thisYear - 2) + 1;
    setYear(next < thisYear ? String(next) : "");
    setAmount("");
    setAdding(true);
  };

  return (
    <div className="space-y-3 sm:col-span-2">
      <div className="flex max-w-2xl flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setImporting(true)}
          className={chip}
        >
          Import SSA Statement
        </button>
        <a
          href="https://www.ssa.gov/myaccount/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold underline underline-offset-2"
          style={{ color: "var(--viz-savings)" }}
        >
          Get it at my Social Security
        </a>
        {record && !confirmRemove ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmRemove(true)}
            className="ml-auto rounded-md px-2 py-1 text-sm font-semibold text-negative ring-1 ring-line transition hover:bg-sky-50 disabled:opacity-50 dark:hover:bg-sky-950/40"
          >
            Remove record
          </button>
        ) : null}
      </div>
      {/* In the app, not the browser's OK box: that one put the focus on OK,
          so Enter deleted every year (Victor, 2026-10-22). */}
      {record && confirmRemove ? (
        <ConfirmStrip
          message={
            <>
              {/* The years shown in the table; later planned years go too. */}
              Delete all {past.length} years of earnings{past.length ? ` (${past[0].year}–${past.at(-1)!.year})` : ""} and the statement?{" "}
              This can&rsquo;t be undone; you&rsquo;d have to import the PDF again.
            </>
          }
          confirmLabel={pending ? "Deleting…" : "Delete"}
          pending={pending}
          onConfirm={() => run(clearSsRecord, () => setConfirmRemove(false))}
          onKeep={() => setConfirmRemove(false)}
        />
      ) : null}

      {record && atAge ? (
        <div className="max-w-2xl overflow-x-auto rounded-lg ring-1 ring-line">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="bg-sky-50 dark:bg-sky-950/40">
                <th className="px-3 py-1.5 text-left font-bold">Monthly benefit</th>
                {atAge.map((a) => (
                  <th key={a.age} className="px-3 py-1.5 text-center font-bold">At {a.age}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr>
                <td className="px-3 py-1.5 font-semibold">
                  Your plan
                  {/* Planned years run to retirement; none after (Victor, 2026-10-22). */}
                  {rows.length ? (
                    <span className="block text-xs font-normal sm:text-sm">Earnings stop after {rows.at(-1)!.year}</span>
                  ) : null}
                </td>
                {atAge.map((a) => (
                  <td key={a.age} className="px-3 py-1.5 text-center font-semibold" style={{ color: "var(--viz-income)" }}>
                    {money(a.cents)}
                  </td>
                ))}
              </tr>
              {record.statement ? (
                <tr>
                  <td className="px-3 py-1.5">
                    SSA statement
                    {/* SSA's own estimate keeps you working at last year's pay
                        right up to the claim age — why it runs higher. */}
                    {record.statement.assumedEarningsCents ? (
                      <span className="block text-xs sm:text-sm">
                        If you earn {money(record.statement.assumedEarningsCents)}/yr until you claim
                      </span>
                    ) : null}
                  </td>
                  {atAge.map((a) => (
                    <td key={a.age} className="px-3 py-1.5 text-center">
                      {record.statement!.retirementByAge[String(a.age)] != null ? money(record.statement!.retirementByAge[String(a.age)]) : "—"}
                    </td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
      {check && check.off > 200 ? (
        <p className="text-xs text-negative sm:text-sm">Calculator is off from the statement by up to {money(check.off)}/mo.</p>
      ) : null}

      {record ? (
        <>
          {/* Three columns on desktop; one list on the phone. Click a row to edit or delete it. */}
          <div className="grid gap-3 max-sm:gap-0 sm:grid-cols-3">
            {thirds.map((part, i) => (
              <div key={i} className={`self-start overflow-hidden ring-1 ring-line rounded-lg ${i > 0 ? "max-sm:-mt-px max-sm:rounded-t-none" : ""} ${i < 2 ? "max-sm:rounded-b-none" : ""} ${part.length ? "" : "max-sm:hidden"}`}>
                <table className="w-full table-fixed text-sm tabular-nums">
                  {/* Fixed widths so the parts line up when stacked on the phone. */}
                  <colgroup>
                    <col className="w-[30%]" />
                    <col className="w-[20%]" />
                    <col className="w-1/2" />
                  </colgroup>
                  <thead className={i > 0 ? "max-sm:hidden" : ""}>
                    <tr className="bg-sky-50 dark:bg-sky-950/40">
                      <th className="px-1.5 sm:px-3 py-1.5 text-center font-bold">Year</th>
                      <th className="px-1.5 sm:px-3 py-1.5 text-center font-bold">Age</th>
                      <th className="px-1.5 sm:px-3 py-1.5 text-center font-bold">Earnings</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {part.map((r) =>
                      editing === r.year ? (
                        <Fragment key={r.year}>
                          <tr className="bg-sky-50 dark:bg-sky-950/40">
                            <td className="px-1.5 sm:px-3 py-1 text-center font-semibold">{r.year}</td>
                            <td className="px-1.5 sm:px-3 py-1 text-center">{birthYear != null ? r.year - birthYear : "—"}</td>
                            <td className="px-1 py-1">
                              <input
                                autoFocus
                                value={editAmount}
                                onChange={(e) => setEditAmount(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    saveEdit();
                                  } else if (e.key === "Escape") {
                                    e.stopPropagation();
                                    setEditing(null);
                                  }
                                }}
                                inputMode="decimal"
                                aria-label={`Earnings for ${r.year}`}
                                className={`${box} mx-auto block w-full max-w-32 py-1 text-center`}
                              />
                            </td>
                          </tr>
                          <tr className="bg-sky-50 dark:bg-sky-950/40">
                            <td colSpan={3} className="px-1.5 pb-1.5 sm:px-3">
                              <div className="flex flex-wrap items-center justify-center gap-2">
                                <button
                                  type="button"
                                  disabled={pending || !editAmount.trim()}
                                  onClick={saveEdit}
                                  className="rounded-md bg-brand px-2.5 py-1 text-sm font-semibold text-white transition hover:bg-brand-strong disabled:opacity-50"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => run(() => deleteSsYear(r.year), () => setEditing(null))}
                                  className="rounded-md px-2.5 py-1 text-sm font-semibold text-negative ring-1 ring-line transition hover:bg-sky-100 disabled:opacity-50 dark:hover:bg-sky-900/50"
                                >
                                  Delete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditing(null)}
                                  className="rounded-md px-2.5 py-1 text-sm font-semibold ring-1 ring-line transition hover:bg-sky-100 hover:ring-sky-400 dark:hover:bg-sky-950/40"
                                >
                                  Cancel
                                </button>
                              </div>
                            </td>
                          </tr>
                        </Fragment>
                      ) : (
                        <tr
                          key={r.year}
                          onClick={() => {
                            setEditing(r.year);
                            setEditAmount((r.cents / 100).toFixed(2));
                          }}
                          className="cursor-pointer transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
                        >
                          <td className="px-1.5 sm:px-3 py-1 text-center">{r.year}</td>
                          <td className="px-1.5 sm:px-3 py-1 text-center">{birthYear != null ? r.year - birthYear : "—"}</td>
                          <td className="px-1.5 sm:px-3 py-1 text-center" style={{ color: "var(--viz-income)" }}>
                            {money(r.cents)}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {/* Total · add year · spousal benefit — one row, the two buttons side
          by side (Victor, 2026-10-22). The tighter gap keeps the longer
          "Spousal Benefit Explanation" link on the same line. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {record ? (
          <p className="text-sm font-semibold">
            Total Earnings So Far: <span className="ml-1 tabular-nums" style={{ color: "var(--viz-income)" }}>{money(posted)}</span>
          </p>
        ) : null}
        {adding ? null : (
          <button type="button" onClick={openAdd} className={chip}>
            Add SSA Year
          </button>
        )}
        {spouseOk && !claimAge ? (
          <button type="button" onClick={() => setClaimAge("67")} className={chip}>
            Add Spousal Benefit
          </button>
        ) : null}
        {spouseOk ? (
          <button
            type="button"
            aria-expanded={why}
            onClick={() => setWhy((v) => !v)}
            className="text-sm font-semibold underline underline-offset-2"
            style={{ color: "var(--viz-savings)" }}
          >
            Spousal Benefit Explanation
          </button>
        ) : null}
      </div>

      {adding ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="w-24">
            <span className={label}>Year</span>
            <input autoFocus={!year} value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" className={`${box} mt-1 w-full text-center`} />
          </label>
          <label className="w-36">
            <span className={label}>Earnings</span>
            <input autoFocus={!!year} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={`${box} mt-1 w-full text-center`} />
          </label>
          <button
            type="button"
            disabled={pending || !yearOk || !amount.trim()}
            onClick={saveYear}
            className="h-[34px] rounded-md bg-brand px-3 text-sm font-semibold text-white transition hover:bg-brand-strong disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="h-[34px] rounded-md px-3 text-sm font-semibold ring-1 ring-line transition hover:bg-sky-100 hover:ring-sky-400 dark:hover:bg-sky-950/40"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {spouseOk ? (
        <>
          {/* Saved with the plan form; the select below only shows once it's added. */}
          <input type="hidden" name="spouseSsClaimAge" value={claimAge} />
          {claimAge ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={label}>Spousal benefit</span>
              <select
                value={claimAge}
                onChange={(e) => setClaimAge(e.target.value)}
                aria-label="Spousal benefit starts at age"
                className={`${box} cursor-pointer`}
              >
                {[62, 63, 64, 65, 66, 67].map((a) => (
                  <option key={a} value={a}>From age {a} ({spouseBirthYear! + a})</option>
                ))}
              </select>
              {spousal != null ? (
                <span className="text-sm font-semibold" style={{ color: "var(--viz-income)" }}>
                  {money(spousal)}/mo
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setClaimAge("")}
                className="rounded-md px-2 py-1 text-sm font-semibold text-negative ring-1 ring-line transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
              >
                Remove
              </button>
            </div>
          ) : null}
          {why ? (
            <div className="space-y-2 rounded-lg px-4 py-3 text-sm text-foreground ring-1 ring-line">
              <p>
                <span className="font-semibold">Spousal Benefit Explanation:</span>{" "}a spouse who hasn&rsquo;t worked enough to earn Social Security of her own can
                still collect a &ldquo;spousal benefit.&rdquo; It pays up to half of what you&rsquo;d get at 67.
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>The dropdown picks the age she starts collecting (62 to 67). At 67 she gets the full half. Each year earlier lowers it, down to about a third at 62.</li>
                <li>Pick an age and her monthly amount appears next to the dropdown. That amount is added to the plan&rsquo;s income from that year on.</li>
                <li>She can&rsquo;t collect before you do: her payments only start once you&rsquo;ve started yours.</li>
                <li>You must have been married at least 1 year (10 years for a divorced spouse).</li>
                <li>Leave it off if she&rsquo;ll get her own Social Security from her own work. She can&rsquo;t collect both in full; she gets whichever is bigger.</li>
              </ul>
              <a
                href="https://www.ssa.gov/family"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block font-semibold underline underline-offset-2"
                style={{ color: "var(--viz-savings)" }}
              >
                Family benefits at SSA.gov
              </a>
            </div>
          ) : null}
        </>
      ) : null}

      {error ? <p className="text-sm font-medium text-negative">{error}</p> : null}
      {importing ? (
        <SsImportModal
          currency={currency}
          savedYears={rows.map((r) => r.year)}
          onClose={() => setImporting(false)}
          onSaved={() => setImporting(false)}
        />
      ) : null}
    </div>
  );
}

/** A combined range on the statement, typed out year by year. */
type RangeDraft = { from: number; to: number; cents: number; years: Record<number, string>; even: Record<number, string> };

/** A warning with Keep and the risky button side by side. Keep is first and
 *  focused, so Enter keeps. */
function ConfirmStrip({
  message,
  confirmLabel,
  pending,
  onConfirm,
  onKeep,
}: {
  message: React.ReactNode;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  return (
    <div role="alertdialog" className="flex max-w-2xl flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-negative/10 px-3 py-2 ring-1 ring-negative/40">
      <p className="min-w-0 flex-1 basis-64 text-sm font-semibold text-foreground">{message}</p>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          autoFocus
          onClick={onKeep}
          className="rounded-md bg-surface px-3 py-1.5 text-sm font-semibold text-foreground ring-1 ring-line transition hover:bg-sky-100 hover:ring-sky-400 dark:hover:bg-sky-950/40"
        >
          Keep
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onConfirm}
          // Dark text in dark mode, where the red is light.
          className="rounded-md bg-negative px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60 dark:text-background"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

function SsImportModal({
  currency,
  savedYears,
  onClose,
  onSaved,
}: {
  currency: string;
  savedYears: number[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [parsed, setParsed] = useState<SsStatement | null>(null);
  // Saved years the statement would write over, while asking first.
  const [replacing, setReplacing] = useState<number[] | null>(null);
  const [ranges, setRanges] = useState<RangeDraft[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const money = (c: number) => formatMoneyWhole(c, currency);

  const read = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setParsed(null);
    setReplacing(null);
    setReading(true);
    try {
      const { readSsaStatementPdf } = await import("@/lib/ssa-statement-pdf");
      const s = parseSsaStatementText(await readSsaStatementPdf(file));
      if (!s) setError("That doesn't look like a Social Security Statement.");
      else {
        setParsed(s);
        // Combined ranges start spread evenly; each year can be typed over.
        const even = earningsByYear(s);
        setRanges(
          s.earnings
            .filter((r) => r.to > r.from)
            .map((r) => {
              const years = Object.fromEntries(
                even.filter((e) => e.year >= r.from && e.year <= r.to).map((e) => [e.year, (e.cents / 100).toFixed(2)]),
              );
              return { ...r, years, even: years };
            }),
        );
      }
    } catch {
      setError("Couldn't read that PDF.");
    } finally {
      setReading(false);
    }
  };

  const rangeTotal = (r: RangeDraft) => Object.values(r.years).reduce((t, v) => t + displayToCents(v || "0"), 0);
  const rangesOk = ranges.every((r) => rangeTotal(r) === r.cents);

  const save = (confirmed = false) => {
    if (!parsed) return;
    const earnings = [
      ...parsed.earnings.filter((r) => r.to === r.from).map((r) => ({ year: r.from, cents: r.cents })),
      // "Split" only while a range is left spread evenly; typed out, it's exact.
      ...ranges.flatMap((r) => {
        const typed = Object.keys(r.years).some((y) => r.years[Number(y)] !== r.even[Number(y)]);
        return Object.entries(r.years).map(([y, v]) => ({ year: Number(y), cents: displayToCents(v || "0"), split: !typed }));
      }),
    ].sort((a, b) => a.year - b.year);
    // Saved years up to the statement's last one are replaced (later ones
    // stay), so ask before writing over them.
    const lastPosted = earnings.at(-1)?.year ?? 0;
    const overwritten = savedYears.filter((y) => y <= lastPosted);
    if (!confirmed && overwritten.length > 0) {
      setReplacing(overwritten);
      return;
    }
    const statement: SsStatementFigures = {
      statementDate: parsed.statementDate,
      retirementByAge: Object.fromEntries(Object.entries(parsed.retirementByAge).map(([a, c]) => [String(a), c])),
      disabilityCents: parsed.disabilityCents,
      survivors: parsed.survivors,
      assumedEarningsCents: parsed.assumedEarningsCents,
    };
    start(async () => {
      const r = await importSsStatement({ birthMonth: parsed.birthMonth, statement, earnings });
      if (r.error) setError(r.error);
      else onSaved();
    });
  };

  const [sy, sm, sd] = parsed ? parsed.statementDate.split("-").map(Number) : [0, 0, 0];

  return (
    <ModalShell
      title="Import SSA statement"
      onClose={onClose}
      className="sm:max-w-2xl"
      headerNotice={
        replacing ? (
          <ConfirmStrip
            message={
              <>
                Replace your {replacing.length} saved years ({replacing[0]}–{replacing.at(-1)}) with this statement&rsquo;s?{" "}
                Any you edited by hand are lost.
              </>
            }
            confirmLabel={pending ? "Saving…" : "Replace"}
            pending={pending}
            onConfirm={() => save(true)}
            onKeep={() => setReplacing(null)}
          />
        ) : undefined
      }
      headerEnd={
        <>
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm font-semibold ring-1 ring-line transition hover:bg-sky-100 hover:ring-sky-400 dark:hover:bg-sky-950/40">
            Cancel
          </button>
          <button
            type="button"
            disabled={!parsed || !rangesOk || pending || replacing != null}
            onClick={() => save()}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-strong disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save record"}
          </button>
        </>
      }
    >
      <div className="space-y-4 p-5">
        <label className="block">
          <span className={label}>Statement PDF</span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => void read(e.target.files?.[0])}
            className="mt-1 block w-full rounded-md bg-sky-50 px-2 py-1.5 text-sm text-foreground ring-1 ring-line file:mr-2 file:rounded file:border-0 file:bg-sky-100 file:px-2 file:py-1 file:text-sm file:font-semibold file:text-foreground dark:bg-background dark:file:bg-sky-900/50"
          />
        </label>
        <p className="text-xs text-foreground sm:text-sm">Read on this device. The file isn&rsquo;t uploaded or kept; your name isn&rsquo;t saved.</p>
        {reading ? <p className="text-sm">Reading…</p> : null}
        {error ? <p className="text-sm font-medium text-negative">{error}</p> : null}

        {parsed ? (
          <>
            <ul className="divide-y divide-line rounded-lg text-sm ring-1 ring-line">
              <li className="flex justify-between gap-3 px-3 py-1.5">
                <span>Statement date</span>
                <span className="font-semibold">{MONTHS[sm - 1]} {sd}, {sy}</span>
              </li>
              <li className="flex justify-between gap-3 px-3 py-1.5">
                <span>Benefit at 62 · 67 · 70</span>
                <span className="font-semibold tabular-nums" style={{ color: "var(--viz-income)" }}>
                  {[62, 67, 70].map((a) => (parsed.retirementByAge[a] != null ? money(parsed.retirementByAge[a]) : "—")).join(" · ")}
                </span>
              </li>
              {parsed.survivors ? (
                <li className="flex justify-between gap-3 px-3 py-1.5">
                  <span>Survivors: child · family max</span>
                  <span className="font-semibold tabular-nums" style={{ color: "var(--viz-income)" }}>
                    {money(parsed.survivors.childCents)} · {money(parsed.survivors.familyMaxCents)}
                  </span>
                </li>
              ) : null}
              <li className="flex justify-between gap-3 px-3 py-1.5">
                <span>Years of earnings</span>
                <span className="font-semibold tabular-nums">
                  {parsed.earnings[0]?.from}–{parsed.earnings.at(-1)?.to} · {money(parsed.earnings.reduce((t, r) => t + r.cents, 0))}
                </span>
              </li>
            </ul>

            {ranges.map((r, i) => {
              const total = rangeTotal(r);
              return (
                <div key={r.from} className="space-y-2 rounded-lg px-3 pb-3 pt-2 ring-1 ring-line">
                  <p className="text-sm font-semibold">
                    {r.from}–{r.to} combined: {money(r.cents)}
                  </p>
                  <p className="text-xs text-foreground sm:text-sm">Split evenly. Type each year if you have it.</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {Object.keys(r.years).map((y) => (
                      <label key={y} className="block">
                        <span className="block text-xs font-bold sm:text-sm">{y}</span>
                        <input
                          value={r.years[Number(y)]}
                          onChange={(e) =>
                            setRanges((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, years: { ...x.years, [y]: e.target.value } } : x)),
                            )
                          }
                          inputMode="decimal"
                          className={`${box} mt-0.5 w-full text-center`}
                        />
                      </label>
                    ))}
                  </div>
                  <p className={`text-xs sm:text-sm ${total === r.cents ? "text-positive" : "text-negative"}`}>
                    {total === r.cents ? `✓ Adds up to ${money(r.cents)}` : `Adds up to ${money(total)}, needs ${money(r.cents)}`}
                  </p>
                </div>
              );
            })}
          </>
        ) : null}
      </div>
    </ModalShell>
  );
}
