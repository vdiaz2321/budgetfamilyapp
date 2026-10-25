"use client";

// The Social Security earnings record on the plan form (Victor, 2026-10-22):
// read the SSA statement once, then add a year at a time — the Invest page's
// import + "Add month" pattern. The statement is read on this device; only
// its numbers go to the server (lib/ssa-statement-pdf, lib/ssa-statement).

import { Fragment, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { ModalShell } from "@/components/modal-shell";
import { displayToCents, formatMoneyWhole } from "@/lib/money";
import { spousalFactor, statementBenefitCents, type SsRecord, type SsStatementFigures } from "@/lib/ssa";
import { ssFamilyMaxCents } from "@/lib/retirement";
import { earningsByYear, parseSsaStatementText, type SsStatement } from "@/lib/ssa-statement";
import { clearSsRecord, deleteSsYear, importSsStatement, saveSsBenefits, saveSsYear } from "./actions";

const box = "rounded-md bg-surface px-2 py-1.5 text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand";
const label = "block max-sm:text-[12px] sm:text-sm font-bold uppercase tracking-wide text-foreground";
const chip = "rounded-md px-3 py-1.5 text-sm font-semibold text-foreground ring-1 ring-line transition hover:ring-brand";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function SsRecordSection({
  record,
  birthYear,
  spouseBirthYear,
  spouseClaimAge,
  thisYear,
  startYear,
  currency,
  toolbarTarget,
  onPlanChange,
}: {
  record: SsRecord | null;
  birthYear: number | null;
  spouseBirthYear: number | null;
  spouseClaimAge: number | null;
  thisYear: number;
  /** The year his Social Security line starts, as typed in the plan form. */
  startYear: number | null;
  currency: string;
  /** The open popup's header: Import / SSA Website / Remove sit there,
   *  pinned at the top (Victor, 2026-10-25). Null keeps them inline. */
  toolbarTarget?: HTMLElement | null;
  /** The spousal start age rides on the plan form in a hidden field, which
   *  fires no change event: this tells the plan popup to re-check Save. */
  onPlanChange?: () => void;
}) {
  const [importing, setImporting] = useState(false);
  const [year, setYear] = useState("");
  const [amount, setAmount] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [adding, setAdding] = useState(false);
  const [why, setWhy] = useState(false);
  const [survivorWhy, setSurvivorWhy] = useState(false);
  const [claimAge, setClaimAgeState] = useState(spouseClaimAge == null ? "" : String(spouseClaimAge));
  const setClaimAge = (v: string) => {
    setClaimAgeState(v);
    onPlanChange?.();
  };
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const money = (c: number) => formatMoneyWhole(c, currency);

  // His benefit at 62, 67 and 70: the statement's own figures, as imported
  // or as he last typed them. Nothing is worked out from planned pay — that
  // was rejected as a guess (Victor, 2026-10-23).
  const AGES = [62, 67, 70] as const;
  // What was just saved, shown until the refreshed record arrives — the plan
  // re-run behind a save takes seconds, and the old figures sat there
  // meanwhile, as if the save hadn't taken.
  const [justSaved, setJustSaved] = useState<Record<string, number> | null>(null);
  const [recordSeen, setRecordSeen] = useState(record);
  if (record !== recordSeen) {
    setRecordSeen(record);
    setJustSaved(null);
  }
  const atAge = AGES.map((age) => ({ age, cents: justSaved?.[age] ?? statementBenefitCents(record, age) }));
  const [editingBenefits, setEditingBenefits] = useState(false);
  const [benefitDraft, setBenefitDraft] = useState<Record<string, string>>({});
  const openBenefits = () => {
    setBenefitDraft(Object.fromEntries(atAge.map((a) => [String(a.age), a.cents == null ? "" : String(a.cents / 100)])));
    setEditingBenefits(true);
  };
  // Shown and closed at once; the save re-runs the whole plan behind it,
  // which took ~2s plus the page refresh — the row sat waiting meanwhile
  // (Victor, 2026-10-23). A rejected save puts the old figures back.
  const saveBenefits = () => {
    const draft = benefitDraft;
    const typed = Object.entries(draft).filter(([, v]) => v.trim() && displayToCents(v) > 0);
    setJustSaved(Object.fromEntries(typed.map(([age, v]) => [age, displayToCents(v)])));
    setEditingBenefits(false);
    start(async () => {
      const r = await saveSsBenefits(draft);
      setError(r.error);
      if (r.error) setJustSaved(null);
    });
  };
  const statementDate = record?.statement?.statementDate;
  // "CAO: 22 Oct 2026" — the statement's as-of date, day first (Victor, 2026-10-23).
  const statementLabel = statementDate
    ? `${Number(statementDate.slice(8, 10))} ${MONTHS[Number(statementDate.slice(5, 7)) - 1]} ${statementDate.slice(0, 4)}`
    : null;

  // The survivor explanation's figures, from the statement's age-67 figure
  // and his start age — the same rules the plan's survivor card uses.
  const survivor = (() => {
    const pia = statementBenefitCents(record, 67);
    if (pia == null) return null;
    // Rounded the way the survivor card rounds, so the two show the same dollars.
    const dollars = (c: number) => Math.round(c);
    const startAge = startYear != null && birthYear != null ? startYear - birthYear : null;
    const own = startAge != null ? statementBenefitCents(record, startAge) : null;
    const base = startAge != null && startAge < 67 ? Math.max(own ?? 0, dollars(pia * 0.825)) : own ?? pia;
    return {
      pia,
      half: dollars(pia / 2),
      threeQuarters: dollars(pia * 0.75),
      at60: dollars(pia * 0.715),
      familyMax: dollars(ssFamilyMaxCents(pia)),
      startAge,
      base,
    };
  })();

  // Half his age-67 figure, cut for each month she starts before 67.
  const spousal = useMemo(() => {
    const age = Number(claimAge);
    const pia = statementBenefitCents(record, 67);
    if (pia == null || spouseBirthYear == null || !age) return null;
    const early = Math.max(0, (67 - age) * 12);
    return Math.floor((pia / 200) * spousalFactor(early) + 1e-7) * 100;
  }, [record, spouseBirthYear, claimAge]);

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

  // The two benefit tables share one header: the label, then the year and
  // age for 62 / 67 / 70, so their columns line up (Victor, 2026-10-25).
  const benefitHead = (label: string) => (
    <>
      {/* Full width to line up with the earnings tables, so on desktop the
          label column is fixed and the three ages share the rest — a fixed
          age width left a wide empty gap after the label (Victor, 2026-10-25). */}
      <colgroup>
        <col className="sm:w-72" />
        {AGES.map((age) => (
          <col key={age} className="w-[4.75rem] sm:w-auto" />
        ))}
      </colgroup>
      <thead>
        <tr className="border-b border-line">
          <th className="px-2 py-1.5 text-left font-bold sm:px-3">{label}</th>
          {/* The year each age lands in, "2048:" over "Age 67" — two
              lines everywhere, which leaves the label column room for
              its line (Victor, 2026-10-23). */}
          {AGES.map((age) => (
            <th key={age} className="px-1.5 py-1.5 text-center font-bold sm:px-3">
              {birthYear != null ? (
                <>
                  <span className="block whitespace-nowrap">{birthYear + age}</span>
                  <span className="block whitespace-nowrap">Age {age}</span>
                </>
              ) : (
                `Age ${age}`
              )}
            </th>
          ))}
        </tr>
      </thead>
    </>
  );

  return (
    <div className="space-y-3 sm:col-span-2">
      {(() => {
        const toolbar = (
      <>
      <div className="flex flex-wrap items-center gap-2">
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
          SSA Website
        </a>
        {/* Up here with Import, beside Close's header (Victor, 2026-10-25);
            what they open shows right under them, not at the popup's end. */}
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
            className="h-[34px] rounded-md px-3 text-sm font-semibold ring-1 ring-line transition hover:ring-brand"
          >
            Cancel
          </button>
        </div>
      ) : null}
      {/* The spousal benefit's start age, once added. */}
      {spouseOk && claimAge ? (
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
      </>
        );
        return toolbarTarget ? createPortal(toolbar, toolbarTarget) : toolbar;
      })()}

      {record ? (
        <div className="space-y-3">
        <div className="overflow-x-auto rounded-lg ring-1 ring-line">
          {/* Fixed column widths, so opening the edit boxes doesn't shift
              the columns (Victor, 2026-10-23). */}
          <table className="w-full table-fixed text-sm tabular-nums">
            {benefitHead("Monthly benefit")}
            <tbody>
              {editingBenefits ? (
                <>
                  <tr className="bg-sky-50 dark:bg-sky-950/40">
                    <td className="px-2 py-1.5 font-semibold sm:px-3">
                      From Annual SSA Statement
                      <span className="block text-xs font-normal sm:text-sm">
                        {statementLabel ? `CAO: ${statementLabel}` : "Type the figures it shows"}
                      </span>
                    </td>
                    {AGES.map((age) => (
                      <td key={age} className="px-1 py-1.5 sm:px-2">
                        <input
                          autoFocus={age === 62}
                          value={benefitDraft[String(age)] ?? ""}
                          onChange={(e) => setBenefitDraft((d) => ({ ...d, [String(age)]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              saveBenefits();
                            } else if (e.key === "Escape") {
                              e.stopPropagation();
                              setEditingBenefits(false);
                            }
                          }}
                          inputMode="decimal"
                          aria-label={`Monthly benefit at ${age}`}
                          className={`${box} mx-auto block w-full py-1 text-center`}
                        />
                      </td>
                    ))}
                  </tr>
                  <tr className="bg-sky-50 dark:bg-sky-950/40">
                    <td />
                    <td colSpan={3} className="px-1 pb-1.5 sm:px-2">
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={saveBenefits}
                          className="rounded-md bg-brand px-2.5 py-1 text-sm font-semibold text-white transition hover:bg-brand-strong"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingBenefits(false)}
                          className="rounded-md px-2.5 py-1 text-sm font-semibold ring-1 ring-line transition hover:ring-brand"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                </>
              ) : (
                // One row, the statement's figures. Click it to type in the
                // new ones after the yearly statement review (Victor, 2026-10-23).
                <tr onClick={openBenefits} className="cursor-pointer transition hover:bg-sky-50 dark:hover:bg-sky-950/40">
                  <td className="px-2 py-1.5 font-semibold sm:px-3">
                    From Annual SSA Statement
                    <span className="block text-xs font-normal sm:text-sm">
                      {/* "click to update" never splits across lines. */}
                      {statementLabel ? <span className="sm:whitespace-nowrap">CAO: {statementLabel} · </span> : null}
                      <span className="whitespace-nowrap">click to update</span>
                    </span>
                  </td>
                  {atAge.map((a) => (
                    <td key={a.age} className="px-1.5 py-1.5 text-center font-semibold sm:px-3" style={{ color: "var(--viz-income)" }}>
                      {a.cents == null ? "—" : money(a.cents)}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {/* A year's worth of each, the monthly figure × 12 (Victor,
            2026-10-23) — its own table since 2026-10-25. Read-only: it
            follows the statement row above. */}
        <div className="overflow-x-auto rounded-lg ring-1 ring-line">
          <table className="w-full table-fixed text-sm tabular-nums">
            {benefitHead("Annual total")}
            <tbody>
              <tr>
                <td className="px-2 py-1.5 font-semibold sm:px-3">Monthly benefit × 12</td>
                {atAge.map((a) => (
                  <td key={a.age} className="px-1.5 py-1.5 text-center font-semibold sm:px-3" style={{ color: "var(--viz-income)" }}>
                    {a.cents == null ? "—" : money(a.cents * 12)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        </div>
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
                    <tr className="border-b border-line">
                      <th className="px-1.5 sm:px-3 py-1.5 text-center font-bold">Year</th>
                      <th className="px-1.5 sm:px-3 py-1.5 text-center font-bold">Age</th>
                      <th className="px-1.5 sm:px-3 py-1.5 text-center font-bold">Earnings</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line font-semibold">
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
                                  className="rounded-md px-2.5 py-1 text-sm font-semibold ring-1 ring-line transition hover:ring-brand"
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

      {/* The total, with the explanations under it. Add SSA Year and Add
          Spousal Benefit moved to the header (Victor, 2026-10-25). */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-line pt-3">
        {record ? (
          <p className="text-sm font-semibold">
            Total Earnings So Far: <span className="ml-1 tabular-nums" style={{ color: "var(--viz-income)" }}>{money(posted)}</span>
          </p>
        ) : null}
        {/* The two explanation links side by side on their own line under
            the buttons, spousal first (Victor, 2026-10-23). */}
        {spouseOk || survivor ? (
          <div className="flex basis-full flex-wrap items-center gap-x-4 gap-y-1">
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
          {survivor ? (
            <button
              type="button"
              aria-expanded={survivorWhy}
              onClick={() => setSurvivorWhy((v) => !v)}
              className="text-sm font-semibold underline underline-offset-2"
              style={{ color: "var(--viz-savings)" }}
            >
              Survivor Benefit Explanation
            </button>
          ) : null}
          </div>
        ) : null}
      </div>


      {spouseOk ? (
        <>
          {/* Saved with the plan form; the select below only shows once it's added. */}
          <input type="hidden" name="spouseSsClaimAge" value={claimAge} />
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

      {/* How the "If you die first" card's Social Security lines are worked
          out, in his own numbers — the card shows the dollars but not the
          rules (Victor, 2026-10-23). Same rules as ssSurvivorParts in
          lib/retirement. */}
      {survivor && survivorWhy ? (
        <div className="max-w-2xl space-y-2">
          {/* A table, not paragraphs: the bulleted version read as a wall of
              words (Victor, 2026-10-23). Same rules as the plan's survivor card. */}
          <div className="overflow-hidden rounded-lg ring-1 ring-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-2 py-1.5 text-left font-bold sm:px-3">Situation</th>
                  <th className="px-2 py-1.5 text-left font-bold sm:px-3">What she gets on your record</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[
                  ["You're alive (spousal)", `Half: ${money(survivor.half)}/mo at 67`],
                  ["You die (widow)", `100%: ${money(survivor.pia)}/mo at 67 · 71.5%: ${money(survivor.at60)}/mo at 60`],
                  ["Caring for your child under 16", `75%: ${money(survivor.threeQuarters)}/mo, any age`],
                  ["Each child under 18", `75%: ${money(survivor.threeQuarters)}/mo each`],
                  ["Family maximum", `${money(survivor.familyMax)}/mo for everyone together`],
                ].map(([who, what]) => (
                  <tr key={who}>
                    <td className="px-2 py-1.5 font-semibold sm:px-3">{who}</td>
                    <td className="px-2 py-1.5 font-semibold tabular-nums sm:px-3" style={{ color: "var(--viz-income)" }}>
                      {what}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {survivor.startAge != null && survivor.startAge < 67 ? (
              <li>
                You start at {survivor.startAge}: die after starting and her base drops to {money(survivor.base)}/mo.
              </li>
            ) : survivor.startAge != null && survivor.startAge > 67 ? (
              <li>
                You start at {survivor.startAge}: once you&rsquo;ve started, her base rises to {money(survivor.base)}/mo.
              </li>
            ) : survivor.startAge === 67 ? (
              <li>You start at 67: her base is {money(survivor.pia)}/mo either way.</li>
            ) : null}
            <li>Die before 62: worked out from your earnings table, so lower.</li>
            <li>Above the family maximum, every share is cut the same %.</li>
          </ul>
          <p className="text-sm">
            Dollars by year: <span className="font-semibold">If you die first</span>, under Retirement details.{" "}
            <a
              href="https://www.ssa.gov/survivor"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline underline-offset-2"
              style={{ color: "var(--viz-savings)" }}
            >
              SSA.gov
            </a>
          </p>
        </div>
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
          className="rounded-md bg-surface px-3 py-1.5 text-sm font-semibold text-foreground ring-1 ring-line transition hover:ring-brand"
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
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm font-semibold ring-1 ring-line transition hover:ring-brand">
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
