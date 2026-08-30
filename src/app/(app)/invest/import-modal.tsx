"use client";

import { useMemo, useState, useTransition } from "react";
import { commitInvestmentImport } from "./import-actions";
import {
  getCell,
  guessMapping,
  parseDate,
  parseCsv,
  parseMoney,
  parsePerformanceDate,
  type ImportKind,
  type ImportMapping,
  type PerformanceMapping,
  type PositionMapping,
} from "./import-utils";
import type { InvestAccount } from "./invest-board";

type Props = {
  accounts: InvestAccount[];
  onClose: () => void;
};

const POSITION_LABELS: Record<keyof PositionMapping, string> = {
  symbol: "Ticker",
  securityName: "Security name",
  quantity: "Quantity / shares",
  price: "Price",
  marketValue: "Current / market value",
  assetClass: "Asset class / type",
  costBasis: "Cost basis",
  unrealizedGain: "Unrealized gain/loss",
  unrealizedGainPercent: "Gain/loss %",
};

const PERFORMANCE_LABELS: Record<keyof PerformanceMapping, string> = {
  period: "Month / date",
  beginningBalance: "Beginning balance",
  marketChange: "Market change",
  dividends: "Dividends",
  interest: "Interest",
  contributions: "Deposits / contributions",
  withdrawals: "Withdrawals",
  fees: "Fees",
  endingBalance: "Ending balance",
};

const today = () => new Date().toISOString().slice(0, 10);

function mappedFields(kind: ImportKind): string[] {
  return kind === "positions"
    ? Object.keys(POSITION_LABELS)
    : Object.keys(PERFORMANCE_LABELS);
}

function validRowCount(kind: ImportKind, headers: string[], rows: string[][], mapping: ImportMapping) {
  if (kind === "positions") {
    const position = mapping as PositionMapping;
    return rows.filter((row) =>
      getCell(headers, row, position.securityName).trim() &&
      parseMoney(getCell(headers, row, position.marketValue)) != null,
    ).length;
  }
  const performance = mapping as PerformanceMapping;
  return rows.filter((row) =>
    parsePerformanceDate(getCell(headers, row, performance.period)) &&
    parseMoney(getCell(headers, row, performance.endingBalance)) != null,
  ).length;
}

export function ImportInvestmentModal({ accounts, onClose }: Props) {
  const [kind, setKind] = useState<ImportKind>("positions");
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ImportMapping>({ ...guessMapping("positions", []) });
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [bucketId, setBucketId] = useState("");
  const [provider, setProvider] = useState("Other");
  const [asOfDate, setAsOfDate] = useState(today());
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ imported: number; skipped: number; appended?: number; replaced?: number } | null>(null);

  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null;
  const selectedBuckets = selectedAccount?.buckets ?? [];
  const mappedCount = useMemo(() => validRowCount(kind, headers, rows, mapping), [kind, headers, rows, mapping]);

  const changeKind = (nextKind: ImportKind) => {
    setKind(nextKind);
    setMapping(guessMapping(nextKind, headers));
    setError(null);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    setFileName(file.name);
    setCsvText(text);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setMapping(guessMapping(kind, parsed.headers));
    setError(null);
    setSaved(null);
    const lowerName = file.name.toLowerCase();
    if (lowerName.includes("fidelity")) setProvider("Fidelity");
    else if (lowerName.includes("schwab")) setProvider("Charles Schwab");
    else if (lowerName.includes("vanguard")) setProvider("Vanguard");
    else if (lowerName.includes("m1")) setProvider("M1 Finance");

    const fileDate = parseDate(file.name);
    if (fileDate) setAsOfDate(fileDate);
    else if (kind === "performance") {
      const guessed = guessMapping("performance", parsed.headers) as PerformanceMapping;
      const dates = parsed.rows
        .map((row) => parsePerformanceDate(getCell(parsed.headers, row, guessed.period)))
        .filter((date): date is string => !!date)
        .sort();
      if (dates.at(-1)) setAsOfDate(dates.at(-1) as string);
    }
  };

  const updateMapping = (field: string, value: string) => {
    setMapping((current) => ({ ...current, [field]: value } as ImportMapping));
  };

  const labels = kind === "positions" ? POSITION_LABELS : PERFORMANCE_LABELS;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/35 p-0 sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="investment-import-title">
      <div className="max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl bg-surface shadow-2xl sm:max-w-3xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-line bg-surface px-5 py-4">
          <div>
            <h2 id="investment-import-title" className="text-lg font-bold">Import investment CSV</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-2xl leading-none text-muted hover:bg-brand-soft hover:text-foreground" aria-label="Close">×</button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted">
              File type
              <select value={kind} onChange={(event) => changeKind(event.target.value as ImportKind)} className="mt-1 w-full rounded-md bg-background px-2 py-2 text-sm text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand">
                <option value="positions">Portfolio positions</option>
                <option value="performance">Monthly performance</option>
              </select>
            </label>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted">
              CSV file
              <input type="file" accept=".csv,text/csv" onChange={(event) => void handleFile(event.target.files?.[0])} className="mt-1 block w-full rounded-md bg-background px-2 py-1.5 text-sm text-foreground ring-1 ring-line file:mr-2 file:rounded file:border-0 file:bg-brand-soft file:px-2 file:py-1 file:text-xs file:font-semibold file:text-brand" />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted">
              Investment account
              <select value={accountId} onChange={(event) => { setAccountId(event.target.value); setBucketId(""); }} className="mt-1 w-full rounded-md bg-background px-2 py-2 text-sm text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand">
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.isKids ? " · Kids Funding" : ""}</option>)}
              </select>
            </label>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted">
              Bucket (optional)
              <select value={bucketId} onChange={(event) => setBucketId(event.target.value)} className="mt-1 w-full rounded-md bg-background px-2 py-2 text-sm text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand">
                <option value="">Account total</option>
                {selectedBuckets.map((bucket) => <option key={bucket.id} value={bucket.id}>{bucket.name}</option>)}
              </select>
            </label>
          </div>

          {fileName ? <p className="rounded-lg bg-brand-soft/50 px-3 py-2 text-xs text-muted"><span className="font-semibold text-foreground">{fileName}</span> · {rows.length} data rows found · {mappedCount} ready to import</p> : <p className="rounded-lg bg-background px-3 py-2 text-xs text-muted ring-1 ring-line">Choose a positions or performance CSV to begin.</p>}

          {headers.length > 0 ? (
            <div className="space-y-2">
              <div>
                <p className="text-sm font-semibold">Column matching</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {mappedFields(kind).map((field) => (
                  <label key={field} className="block text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {labels[field as keyof typeof labels]}
                    <select value={(mapping as Record<string, string>)[field] ?? ""} onChange={(event) => updateMapping(field, event.target.value)} className="mt-1 w-full rounded-md bg-background px-2 py-2 text-sm font-normal normal-case tracking-normal text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand">
                      <option value="">Not provided</option>
                      {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {headers.length > 0 ? <ImportPreview kind={kind} headers={headers} rows={rows} mapping={mapping} /> : null}
          {error ? <p className="text-sm font-medium text-negative">{error}</p> : null}
          {saved ? <p className="rounded-lg bg-positive/10 px-3 py-2 text-sm font-medium text-positive">Imported {saved.imported} rows{saved.appended != null ? ` · added ${saved.appended} new · replaced ${saved.replaced ?? 0}` : ""}{saved.skipped ? ` · skipped ${saved.skipped} unreadable rows` : ""}.</p> : null}

          <form action={(formData) => start(async () => {
            const result = await commitInvestmentImport(formData);
            if (result?.error) setError(result.error);
            else if (result) setSaved({ imported: result.imported ?? 0, skipped: result.skipped ?? 0, appended: result.appended, replaced: result.replaced });
          })} className="flex items-center justify-end gap-2 border-t border-line pt-4">
            <input type="hidden" name="csvText" value={csvText} />
            <input type="hidden" name="fileName" value={fileName} />
            <input type="hidden" name="importKind" value={kind} />
            <input type="hidden" name="accountId" value={accountId} />
            <input type="hidden" name="bucketId" value={bucketId} />
            <input type="hidden" name="provider" value={provider} />
            <input type="hidden" name="asOfDate" value={asOfDate} />
            <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
            <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-muted hover:text-foreground">Close</button>
            <button type="submit" disabled={pending || !csvText || !accountId || mappedCount === 0} className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50">
              {pending ? "Importing…" : `Import ${mappedCount || ""} rows`}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function ImportPreview({ kind, headers, rows, mapping }: { kind: ImportKind; headers: string[]; rows: string[][]; mapping: ImportMapping }) {
  const sampleRows = rows.slice(0, 4);
  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-line">
      <div className="flex items-center justify-between bg-background px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Preview</p>
        <p className="text-xs text-muted">First {sampleRows.length} rows</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-surface text-left text-[10px] uppercase tracking-wide text-muted">
            <tr>{(kind === "positions" ? ["symbol", "securityName", "marketValue"] : ["period", "contributions", "marketChange", "endingBalance"]).map((field) => <th key={field} className="px-3 py-2">{field}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sampleRows.map((row, index) => <tr key={index}>{(kind === "positions" ? ["symbol", "securityName", "marketValue"] : ["period", "contributions", "marketChange", "endingBalance"]).map((field) => <td key={field} className="max-w-52 truncate px-3 py-2 text-foreground">{getCell(headers, row, (mapping as Record<string, string>)[field] ?? "") || "—"}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
