"use client";

import { useState, useTransition } from "react";
import { ModalShell } from "@/components/modal-shell";
import { previewImport, commitImport, type PreviewResult, type ImportResult } from "./import-actions";

export function ImportCsvModal({ onClose }: { onClose: () => void }) {
  const [csvText, setCsvText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string>("");
  const [pending, start] = useTransition();

  async function onFile(f: File | null) {
    setError("");
    setPreview(null);
    setResult(null);
    if (!f) return;
    setFileName(f.name);
    const text = await f.text();
    setCsvText(text);
    start(async () => {
      try {
        const p = await previewImport(text);
        setPreview(p);
      } catch (e) {
        setError(String((e as Error).message ?? e));
      }
    });
  }

  function onCommit() {
    if (!csvText) return;
    start(async () => {
      try {
        const r = await commitImport(csvText);
        setResult(r);
      } catch (e) {
        setError(String((e as Error).message ?? e));
      }
    });
  }

  return (
    <ModalShell title="Import Transactions from CSV" onClose={onClose}>
      <div className="space-y-4 p-5">
        {!preview && !result ? (
          <>
            <p className="text-sm text-muted">
              Choose a CSV exported from your Google Sheet log. Import is idempotent —
              re-uploading the same file is safe.
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-strong"
            />
            {pending ? <p className="text-sm text-muted">Parsing…</p> : null}
          </>
        ) : null}

        {error ? (
          <div className="rounded-lg bg-negative/10 p-3 text-sm text-negative">{error}</div>
        ) : null}

        {preview && !result ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-brand-soft/40 p-3 text-sm">
              <p className="font-semibold">{fileName}</p>
              <p className="text-muted">
                {preview.totalRows} rows · <span className="font-semibold text-foreground">{preview.toImport}</span> will import ·{" "}
                {preview.toSkip.length} skipped by rule ·{" "}
                {preview.unmappedSubs.length} unknown subcategories
              </p>
            </div>

            {preview.toAutoCreateSubs.length > 0 ? (
              <Section title={`Will auto-create ${preview.toAutoCreateSubs.length} subcategories`}>
                <ul className="space-y-1 text-sm">
                  {preview.toAutoCreateSubs.map((k) => (
                    <li key={k} className="text-muted">
                      <span className="font-medium text-foreground">{k.split("|")[1]}</span>
                      <span className="text-xs"> ({k.split("|")[0]})</span>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            <Section title={`Card mapping (${preview.cardSummary.length} unique)`}>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                {preview.cardSummary.map((c) => (
                  <li key={c.csvValue} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      <span className="font-mono text-xs">{c.csvValue}</span>
                      <span className="ml-2 text-xs text-muted">× {c.rowCount}</span>
                    </span>
                    {c.matchedAccount ? (
                      <span className="whitespace-nowrap rounded-full bg-positive/15 px-2 py-0.5 text-xs font-medium text-positive">
                        → {c.matchedAccount}
                      </span>
                    ) : (
                      <span className="whitespace-nowrap rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                        no account
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>

            {preview.unmappedSubs.length > 0 ? (
              <Section title={`Unknown subcategories (${preview.unmappedSubs.length}) — these rows will be dropped`}>
                <ul className="max-h-32 space-y-1 overflow-y-auto text-sm">
                  {preview.unmappedSubs.map((s) => (
                    <li key={s.key} className="text-muted">
                      <span className="text-foreground">{s.key}</span> · {s.rowCount} rows
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {preview.toSkip.length > 0 ? (
              <Section title={`Skipped by rule (${preview.toSkip.length})`}>
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted">Show details</summary>
                  <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs">
                    {preview.toSkip.slice(0, 50).map((s) => (
                      <li key={s.rowIndex} className="text-muted">
                        row {s.rowIndex}: {s.reason}
                      </li>
                    ))}
                    {preview.toSkip.length > 50 ? (
                      <li className="text-muted">…and {preview.toSkip.length - 50} more</li>
                    ) : null}
                  </ul>
                </details>
              </Section>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-black/5 dark:hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending || preview.toImport === 0}
                onClick={onCommit}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-brand-strong disabled:opacity-50"
              >
                {pending ? "Importing…" : `Import ${preview.toImport} transactions`}
              </button>
            </div>
          </div>
        ) : null}

        {result ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-positive/10 p-3 text-sm">
              <p className="font-semibold text-positive">Import complete</p>
              <p className="text-muted">
                Inserted <span className="font-semibold text-foreground">{result.imported}</span> new · already existed{" "}
                <span className="font-semibold text-foreground">{result.skippedAlreadyExists}</span> · skipped by rule{" "}
                <span className="font-semibold text-foreground">{result.skippedByRule}</span>
              </p>
            </div>
            {result.autoCreated.length > 0 ? (
              <Section title={`Created ${result.autoCreated.length} subcategories`}>
                <ul className="text-sm">
                  {result.autoCreated.map((k) => (
                    <li key={k} className="text-muted">{k}</li>
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
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      {children}
    </div>
  );
}
