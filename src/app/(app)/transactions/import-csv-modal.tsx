"use client";

import { useState, useTransition } from "react";
import { ModalShell } from "@/components/modal-shell";
import { formatMoney } from "@/lib/money";
import { parseCsv } from "../invest/import-utils";
import { previewImport, commitImport, type PreviewResult, type ImportResult } from "./import-actions";
import {
  detectDateOrder,
  guessMapping,
  IMPORT_FIELDS,
  mappingProblem,
  type ColumnMapping,
  type DateOrder,
  type ImportField,
} from "./import-utils";

const FIELD_NOTES: Partial<Record<ImportField, string>> = {
  type: "Expenses, Bills, Income…",
  category: "Restaurants, Groceries… must already be in your budget.",
  account: "Matched to your accounts by name.",
};

export function ImportCsvModal({ onClose }: { onClose: () => void }) {
  const [csvText, setCsvText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [pickedDateOrder, setPickedDateOrder] = useState<DateOrder | "">("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string>("");
  const [pending, start] = useTransition();

  async function onFile(f: File | null) {
    setError("");
    setPreview(null);
    setResult(null);
    setMapping(null);
    setPickedDateOrder("");
    if (!f) return;
    const text = await f.text();
    const parsed = parseCsv(text);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setError("No columns found in this file. It needs a header row, with commas between the columns.");
      return;
    }
    setFileName(f.name);
    setCsvText(text);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setMapping(guessMapping(parsed.headers));
  }

  function chooseAnotherFile() {
    setMapping(null);
    setError("");
  }

  function pickColumn(field: ImportField, value: string) {
    if (!mapping) return;
    setMapping({ ...mapping, [field]: Number(value) });
    setPickedDateOrder("");
  }

  const detectedOrder = mapping && mapping.date >= 0
    ? detectDateOrder(rows.map((row) => row[mapping.date] ?? ""))
    : null;
  const dateOrder: DateOrder | null =
    detectedOrder === "ask" ? pickedDateOrder || null : detectedOrder;
  const problem = mapping
    ? mappingProblem(mapping, headers) ?? (detectedOrder === "ask" && !dateOrder ? "Choose how the dates are written." : null)
    : null;

  function onCheck() {
    if (!mapping || problem) return;
    setError("");
    start(async () => {
      try {
        setPreview(await previewImport(csvText, mapping, dateOrder));
      } catch (e) {
        setError(String((e as Error).message ?? e));
      }
    });
  }

  function onCommit() {
    if (!mapping) return;
    setError("");
    start(async () => {
      try {
        setResult(await commitImport(csvText, mapping, dateOrder));
      } catch (e) {
        setError(String((e as Error).message ?? e));
      }
    });
  }

  return (
    <ModalShell title="Import transactions" onClose={onClose}>
      <div className="space-y-4 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        {!mapping ? (
          <>
            <p className="text-[13.5px] text-foreground">
              Choose a CSV from your spreadsheet or bank. Next you&apos;ll match its columns.
              Uploading the same file twice is safe.
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-strong"
            />
          </>
        ) : null}

        {error ? (
          <div className="rounded-lg bg-negative/10 p-3 text-sm text-negative">{error}</div>
        ) : null}

        {mapping && !preview && !result ? (
          <div className="space-y-4">
            <p className="text-sm">
              <span className="font-semibold">{fileName}</span> · {rows.length} {rows.length === 1 ? "row" : "rows"}
            </p>

            <div className="divide-y divide-line rounded-lg border border-line">
              {IMPORT_FIELDS.map(({ field, label, required }) => {
                const at = mapping[field];
                const sample = at >= 0 ? rows.map((row) => row[at]).find((v) => v) ?? "" : "";
                return (
                  <div
                    key={field}
                    className="grid grid-cols-1 gap-1.5 p-3 sm:grid-cols-[8rem_minmax(0,15rem)_minmax(0,1fr)] sm:items-center sm:gap-3"
                  >
                    <label htmlFor={`import-${field}`} className="text-sm font-semibold">
                      {label}
                      {required ? <span className="text-negative"> *</span> : null}
                    </label>
                    <select
                      id={`import-${field}`}
                      value={at}
                      onChange={(e) => pickColumn(field, e.target.value)}
                      className="w-full rounded-md bg-background px-2 py-2 text-sm text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
                    >
                      <option value={-1}>{required ? "Choose a column" : "Not in my file"}</option>
                      {headers.map((header, i) => (
                        <option key={i} value={i}>{header || `Column ${i + 1} (no name)`}</option>
                      ))}
                    </select>
                    <p className="min-w-0 truncate text-[13.5px] italic text-foreground">
                      {sample ? `e.g. ${sample}` : FIELD_NOTES[field] ?? ""}
                    </p>
                  </div>
                );
              })}
              {detectedOrder === "ask" ? (
                <div className="grid grid-cols-1 gap-1.5 p-3 sm:grid-cols-[8rem_minmax(0,15rem)_minmax(0,1fr)] sm:items-center sm:gap-3">
                  <label htmlFor="import-date-order" className="text-sm font-semibold">
                    Dates read as<span className="text-negative"> *</span>
                  </label>
                  <select
                    id="import-date-order"
                    value={pickedDateOrder}
                    onChange={(e) => setPickedDateOrder(e.target.value as DateOrder | "")}
                    className="w-full rounded-md bg-background px-2 py-2 text-sm text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
                  >
                    <option value="">Choose one</option>
                    <option value="mdy">Month / day / year</option>
                    <option value="dmy">Day / month / year</option>
                  </select>
                  <p className="text-[13.5px] italic text-foreground">This file&apos;s dates could be either.</p>
                </div>
              ) : null}
            </div>

            {problem ? <p className="text-sm font-medium text-negative">{problem}</p> : null}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={chooseAnotherFile}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-foreground hover:bg-sky-50 dark:hover:bg-sky-950/40"
              >
                Choose another file
              </button>
              <button
                type="button"
                disabled={pending || !!problem}
                onClick={onCheck}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-brand-strong disabled:opacity-50"
              >
                {pending ? "Checking…" : "Check rows"}
              </button>
            </div>
          </div>
        ) : null}

        {preview && !result ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-line p-3 text-sm">
              <p className="font-semibold">{fileName}</p>
              <p>
                {preview.totalRows} {preview.totalRows === 1 ? "row" : "rows"} · <span className="font-semibold">{preview.toImport}</span> will import ·{" "}
                {preview.toSkip.length} skipped ·{" "}
                {preview.unmappedSubs.reduce((sum, s) => sum + s.rowCount, 0)} with an unknown category
              </p>
              {preview.toImport === 0 ? (
                <p className="mt-1 font-medium text-negative">
                  Nothing can import. Check the columns, or the reasons below.
                </p>
              ) : null}
            </div>

            {preview.bothSigns ? (
              <p className="rounded-lg bg-negative/10 p-3 text-sm text-negative">
                This file has plus and minus amounts. Minus signs are dropped, so a refund imports as spending.
              </p>
            ) : null}

            {preview.firstRows.length > 0 ? (
              <Section title="First rows, as they'll be saved">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-[13.5px]">
                    <thead>
                      <tr>
                        {["Date", "Amount", "Type", "Category", "Payee", "Account", "Remarks"].map((h) => (
                          <th key={h} className="px-2 pb-1 text-center font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.firstRows.map((r) => (
                        <tr key={r.rowIndex} className="border-t border-line">
                          <td className="whitespace-nowrap px-2 py-1 text-center">{r.date}</td>
                          <td className="whitespace-nowrap px-2 py-1 text-center">{formatMoney(r.amountCents)}</td>
                          <td className="px-2 py-1 text-center">{r.type}</td>
                          <td className="px-2 py-1 text-center">{r.category}</td>
                          <td className="px-2 py-1 text-center">{r.payee}</td>
                          <td className="px-2 py-1 text-center">{r.account}</td>
                          <td className="px-2 py-1 text-center">{r.remarks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            ) : null}

            {preview.toAutoCreateSubs.length > 0 ? (
              <Section title={`Will auto-create ${preview.toAutoCreateSubs.length} categories`}>
                <ul className="space-y-1 text-sm">
                  {preview.toAutoCreateSubs.map((k) => (
                    <li key={k}>
                      <span className="font-medium">{k.split("|")[1]}</span>
                      <span className="text-xs"> ({k.split("|")[0]})</span>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {preview.cardSummary.length > 0 ? (
              <Section title={`Account matching (${preview.cardSummary.length} unique)`}>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                  {preview.cardSummary.map((c) => (
                    <li key={c.csvValue} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className="font-mono text-xs">{c.csvValue}</span>
                        <span className="ml-2 text-xs">× {c.rowCount}</span>
                      </span>
                      {c.matchedAccount ? (
                        <span className="whitespace-nowrap rounded-full bg-positive/15 px-2 py-0.5 text-xs font-medium text-positive">
                          → {c.matchedAccount}
                        </span>
                      ) : (
                        <span className="whitespace-nowrap text-xs italic">no account</span>
                      )}
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {preview.unmappedSubs.length > 0 ? (
              <Section title={`Categories not in your budget (${preview.unmappedSubs.length}) — these rows won't import`}>
                <ul className="max-h-32 space-y-1 overflow-y-auto text-sm">
                  {preview.unmappedSubs.map((s) => (
                    <li key={s.key}>
                      {s.key} · {s.rowCount} {s.rowCount === 1 ? "row" : "rows"}
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {preview.toSkip.length > 0 ? (
              <Section title={`Skipped (${preview.toSkip.length})`}>
                <details className="text-sm">
                  <summary className="cursor-pointer">Show details</summary>
                  <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs">
                    {preview.toSkip.slice(0, 50).map((s) => (
                      <li key={s.rowIndex}>
                        row {s.rowIndex}: {s.reason}
                      </li>
                    ))}
                    {preview.toSkip.length > 50 ? (
                      <li>…and {preview.toSkip.length - 50} more</li>
                    ) : null}
                  </ul>
                </details>
              </Section>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-foreground hover:bg-sky-50 dark:hover:bg-sky-950/40"
              >
                Change columns
              </button>
              <button
                type="button"
                disabled={pending || preview.toImport === 0}
                onClick={onCommit}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-brand-strong disabled:opacity-50"
              >
                {pending ? "Importing…" : `Import ${preview.toImport} ${preview.toImport === 1 ? "transaction" : "transactions"}`}
              </button>
            </div>
          </div>
        ) : null}

        {result ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-positive/10 p-3 text-sm">
              <p className="font-semibold text-positive">Import complete</p>
              <p>
                Inserted <span className="font-semibold">{result.imported}</span> new · already existed{" "}
                <span className="font-semibold">{result.skippedAlreadyExists}</span> · skipped{" "}
                <span className="font-semibold">{result.skipped}</span>
              </p>
            </div>
            {result.autoCreated.length > 0 ? (
              <Section title={`Created ${result.autoCreated.length} categories`}>
                <ul className="text-sm">
                  {result.autoCreated.map((k) => (
                    <li key={k}>{k}</li>
                  ))}
                </ul>
              </Section>
            ) : null}
            {result.errors.length > 0 ? (
              <Section title={`Errors (${result.errors.length})`}>
                <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-negative">
                  {result.errors.map((e, i) => (<li key={i}>{e}</li>))}
                </ul>
              </Section>
            ) : null}
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-brand-strong"
              >
                Done
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </ModalShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground">{title}</p>
      {children}
    </div>
  );
}
