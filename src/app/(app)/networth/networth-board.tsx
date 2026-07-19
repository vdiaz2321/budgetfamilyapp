"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { centsToDisplay, currencySymbol, formatMoney } from "@/lib/money";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { setAccountSnapshot, setBucketSnapshot, setNetworthHistory } from "./actions";
import { reorderAccounts, reorderBuckets, renameAccount, updateBucket } from "../accounts/actions";

export type MonthPoint = {
  month: string; // YYYY-MM-01
  savings: number; // long-term savings pile (Banking, bank_group=savings)
  bank: number; // everyday bank accounts (Banking, not savings)
  stocks: number; // investments
  debt: number; // = liabilities
  assets: number; // savings + bank + stocks (gross)
  liabilities: number; // = debt
  net: number; // assets − debt (actual net worth)
  nwWithoutInvest: number; // savings + bank
  fromHistory: boolean; // section-level (pre per-account) vs derived
};

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function monthLabel(month: string): string {
  const idx = parseInt(month.slice(5, 7), 10) - 1;
  return `${MONTHS_SHORT[idx]} ${month.slice(0, 4)}`;
}

function pctLabel(p: number | null): string {
  if (p == null) return "—";
  return `${p >= 0 ? "+" : ""}${(p * 100).toFixed(2)}%`;
}

// Compact tick label: $12.5K / $1.2M (cents in, display out).
function compactMoney(cents: number, currency: string): string {
  const abs = Math.abs(cents) / 100;
  const sign = cents < 0 ? "−" : "";
  const sym = currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}${sym}${Math.round(abs / 1000)}K`;
  if (abs >= 1_000) return `${sign}${sym}${(abs / 1000).toFixed(1)}K`;
  return `${sign}${sym}${Math.round(abs)}`;
}

// Round a raw step up to a clean 1/2/5 × 10^n value.
function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / pow;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return nice * pow;
}

// Clean y-axis ticks spanning [min, max].
function makeTicks(min: number, max: number): number[] {
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.1);
    return makeTicks(min - pad, max + pad);
  }
  const step = niceStep((max - min) / 4);
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; ; v += step) {
    ticks.push(v);
    if (v >= max) break;
  }
  return ticks;
}

// One account (or Budget debt) row in the monthly balances grid.
export type GridRow = {
  name: string;
  liability: boolean;
  // Account is linked to a Budget debt — shown but not counted (the debt row is).
  linked: boolean;
  // Kids Funding — shown but not counted.
  excluded?: boolean;
  // Same grouping as the sidebar, so the two views read as one system.
  section: "Budget" | "Investments" | "Kids Funding" | "Credit Cards" | "Loans";
  balances: (number | null)[]; // aligned to gridMonths
  // A bucket / "Unallocated" sub-row indented under its parent account.
  indent?: boolean;
  // Parent account that has bucket sub-rows below it.
  hasChildren?: boolean;
  // How many buckets it has — shown next to the name, mirroring the
  // Accounts page's "N buckets" label.
  bucketCount?: number;
  // The auto "Unallocated" remainder row — rendered subtly.
  muted?: boolean;
  // Set on a hasChildren row so its bucket rows can be collapsed by id.
  id?: string;
  // Set on a bucket / Unallocated row — the id of the account it belongs to.
  parentId?: string;
  // Editing: which snapshot this row writes, if any.
  accountId?: string;
  bucketId?: string;
  editable?: boolean;
};

// Kids Funding sits last, after the household's own asset and liability
// sections — it's the kids' money, excluded from every total, so it reads as
// a footnote below everything else (matches the Accounts page's layout).
const SECTION_ORDER: GridRow["section"][] = [
  "Budget",
  "Investments",
  "Credit Cards",
  "Loans",
  "Kids Funding",
];

type Props = {
  points: MonthPoint[];
  gridMonths: string[];
  gridRows: GridRow[];
  currency: string;
};

export function NetworthBoard({ points, gridMonths, gridRows, currency }: Props) {
  const latest = points[points.length - 1] ?? null;

  // One year selection shared by both the summary block and the monthly table.
  const years = [...new Set(points.map((p) => p.month.slice(0, 4)))].sort((a, b) =>
    b.localeCompare(a),
  );
  const [year, setYear] = useState<string>(years[0] ?? "");

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Net Worth</h1>
        <p className="text-sm text-muted">
          Assets minus debts, archived monthly from your Accounts and Budget debt balances.
        </p>
      </div>

      {/* Current position */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Assets / Cash O/H" value={latest?.assets ?? 0} currency={currency} tone="text-positive" />
        <Stat label="Debts" value={latest?.liabilities ?? 0} currency={currency} tone="text-negative" />
        <Stat
          label="Net worth"
          value={latest?.net ?? 0}
          currency={currency}
          tone={(latest?.net ?? 0) >= 0 ? "text-foreground" : "text-negative"}
        />
      </div>

      {/* Over-time chart */}
      <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
        <div className="border-b border-line px-4 py-2.5">
          <h2 className="font-semibold">Net Worth Over Time</h2>
        </div>
        {points.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">
            No history yet — it starts accruing as soon as you enter account balances.
            Each month freezes automatically; check back as months pass.
          </p>
        ) : (
          <NetworthChart points={points} currency={currency} />
        )}
      </section>

      {/* Monthly balances by account — the sheet's per-account grid */}
      {gridRows.length > 0 ? (
        <BalanceGrid months={gridMonths} rows={gridRows} currency={currency} />
      ) : null}

      {/* Transposed summary — the sheet's top block (Total Assets → NW w/out Invest) */}
      {points.length > 0 ? (
        <SummaryBlock
          points={points}
          currency={currency}
          years={years}
          year={year}
          onYearChange={setYear}
        />
      ) : null}

      {/* Monthly Net Worth analytics — the sheet's YearlyNetWorth tab */}
      {points.length > 0 ? (
        <MonthlyAnalytics points={points} currency={currency} year={year} />
      ) : null}

      {/* Backfill months from before you tracked individual accounts */}
      <HistoricalEntry currency={currency} />

      {/* Year by year */}
      {points.length > 0 ? <YearTable points={points} currency={currency} /> : null}
    </div>
  );
}

function Stat({
  label,
  value,
  currency,
  tone,
}: {
  label: string;
  value: number;
  currency: string;
  tone: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl bg-surface px-4 py-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${tone}`}>
        {formatMoney(value, currency)}
      </p>
    </div>
  );
}

// Single-series line: 2px brand line, 10% area wash, end dot with surface
// ring, hairline gridlines, crosshair + tooltip snapping to nearest month.
function NetworthChart({ points, currency }: { points: MonthPoint[]; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 640;
  const H = 180;
  const M = { l: 56, r: 20, t: 16, b: 26 };
  const iw = W - M.l - M.r;
  const ih = H - M.t - M.b;

  const nets = points.map((p) => p.net);
  const ticks = makeTicks(Math.min(0, ...nets), Math.max(0, ...nets));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const x = (i: number) =>
    M.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => M.t + ih - ((v - yMin) / (yMax - yMin)) * ih;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.net)}`).join(" ");
  const areaPath =
    points.length > 1
      ? `${linePath} L${x(points.length - 1)},${y(Math.max(yMin, 0))} L${x(0)},${y(Math.max(yMin, 0))} Z`
      : null;

  // Snap pointer to the nearest month.
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const rel = (px - M.l) / (points.length === 1 ? 1 : iw);
    const idx = Math.round(rel * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, points.length === 1 ? 0 : idx)));
  };

  const hovered = hover != null ? points[hover] : null;
  const lastIdx = points.length - 1;

  // X labels: first, last, and up to ~4 evenly spaced between.
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="nw-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Gridlines + y ticks */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)}
              stroke="var(--border)" strokeWidth="1" strokeDasharray="2 4"
            />
            <text
              x={M.l - 8} y={y(t) + 3.5}
              textAnchor="end" fontSize="11"
              fill="var(--muted)"
            >
              {compactMoney(t, currency)}
            </text>
          </g>
        ))}

        {yMin < 0 ? (
          <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} stroke="var(--muted)" strokeWidth="1" />
        ) : null}

        {areaPath ? <path d={areaPath} fill="url(#nw-fill)" /> : null}
        {points.length > 1 ? (
          <path
            d={linePath}
            fill="none"
            stroke="var(--brand)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}

        <circle cx={x(lastIdx)} cy={y(points[lastIdx].net)} r="6" fill="var(--surface)" />
        <circle cx={x(lastIdx)} cy={y(points[lastIdx].net)} r="4" fill="var(--brand)" />
        {hover != null && hover !== lastIdx ? (
          <>
            <circle cx={x(hover)} cy={y(points[hover].net)} r="6" fill="var(--surface)" />
            <circle cx={x(hover)} cy={y(points[hover].net)} r="4" fill="var(--brand)" />
          </>
        ) : null}

        {hover != null ? (
          <line
            x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + ih}
            stroke="var(--muted)" strokeWidth="1"
          />
        ) : null}

        {points.map((p, i) =>
          i % labelEvery === 0 || i === lastIdx ? (
            <text
              key={p.month}
              x={x(i)} y={H - 8}
              textAnchor="middle" fontSize="11"
              fill="var(--muted)"
            >
              {monthLabel(p.month)}
            </text>
          ) : null,
        )}
      </svg>

      {hovered != null && hover != null ? (
        <div
          className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-lg bg-surface px-3 py-2 text-center shadow-md ring-1 ring-black/10 dark:ring-white/15"
          style={{ left: `${(x(hover) / W) * 100}%` }}
        >
          <p className="text-sm font-bold tabular-nums">{formatMoney(hovered.net, currency)}</p>
          <p className="text-[11px] text-muted">{monthLabel(hovered.month)}</p>
          <p className="text-[10px] text-muted tabular-nums">
            {formatMoney(hovered.assets, currency)} assets · {formatMoney(hovered.liabilities, currency)} debts
          </p>
        </div>
      ) : null}
    </div>
  );
}

// One editable snapshot cell — reads like text until focused, saves on blur.
// Mirrors the Accounts page balance input, sized down for the grid.
function SnapshotCell({
  variant,
  id,
  month,
  cents,
  currency,
  liability,
}: {
  variant: "account" | "bucket";
  id: string;
  month: string;
  cents: number | null;
  currency: string;
  liability?: boolean;
}) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = cents == null ? "" : centsToDisplay(cents);
  const action = variant === "account" ? setAccountSnapshot : setBucketSnapshot;
  const idName = variant === "account" ? "accountId" : "bucketId";

  return (
    <form
      ref={formRef}
      action={(fd) => start(() => action(fd))}
      className="flex items-center justify-center gap-0.5"
    >
      <input type="hidden" name={idName} value={id} />
      <input type="hidden" name="month" value={month} />
      <span className="pointer-events-none text-xs text-muted">{currencySymbol(currency)}</span>
      <input
        key={initial}
        name="balance"
        type="text"
        inputMode="decimal"
        defaultValue={initial}
        placeholder="—"
        size={Math.max(initial.length, 4) + 1}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          if (e.currentTarget.value !== initial) formRef.current?.requestSubmit();
        }}
        className={`min-w-0 rounded-md bg-transparent px-1 py-0.5 text-right text-sm tabular-nums transition hover:bg-brand-soft/40 focus:bg-background focus:outline-none focus:ring-2 ${
          liability && cents != null && cents > 0 ? "text-negative" : ""
        } ${pending ? "ring-2 ring-brand" : "focus:ring-brand"}`}
      />
    </form>
  );
}

// Inline-editable account/bucket name — reads like text until clicked, saves
// on blur. `rename` is renameAccount or updateBucket from the Accounts
// actions, both of which take just {id, name} form fields.
function GridNameCell({
  id,
  name,
  rename,
}: {
  id: string;
  name: string;
  rename: (formData: FormData) => Promise<void | { error: string | null }>;
}) {
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    // No `flex-1` — that stretched this to fill the whole name column,
    // shoving the "N buckets" label and chips that follow it all the way to
    // the right instead of sitting close to the name (see feedback:
    // "buckets are far off to the right"). `size` sizes it to the name's own
    // length instead, same trick BucketNameInput/BalanceInput use elsewhere.
    <form ref={formRef} action={(fd) => start(() => void rename(fd))} className="flex min-w-0 shrink">
      <input type="hidden" name="id" value={id} />
      <input
        key={name}
        name="name"
        defaultValue={name}
        size={Math.min(Math.max(name.length, 6), 28)}
        onBlur={(e) => {
          if (e.currentTarget.value.trim() && e.currentTarget.value !== name) {
            formRef.current?.requestSubmit();
          } else {
            e.currentTarget.value = name;
          }
        }}
        className={`min-w-0 rounded-md bg-transparent px-1 py-0.5 text-left text-[0.9375rem] font-medium transition hover:bg-brand-soft/40 focus:bg-background focus:outline-none focus:ring-2 ${
          pending ? "ring-2 ring-brand" : "focus:ring-brand"
        }`}
      />
    </form>
  );
}

// Drag handle — press and drag a row onto another row in the same list to
// reorder. Uses plain mouse events rather than the native HTML5 drag API or
// Pointer Events: native drag-and-drop needs the browser to recognize an
// OS-level drag gesture on the exact element (unreliable across trackpads/
// browsers, and never fires for synthetic input), and Pointer Events aren't
// consistently synthesized from mouse-only input either. Mouse events are
// the one thing every input path reliably produces.
function GripHandle({ onMouseDown, title }: { onMouseDown: () => void; title: string }) {
  return (
    <span
      onMouseDown={(e) => {
        e.preventDefault();
        onMouseDown();
      }}
      title={title}
      className="flex shrink-0 cursor-grab items-center rounded p-0.5 text-muted/60 transition hover:bg-background/60 hover:text-muted active:cursor-grabbing"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </span>
  );
}

// Accounts × months grid: your monthly checkup view. Cells are editable —
// current-month edits also update the Accounts page; past months are history.
function BalanceGrid({
  months,
  rows,
  currency,
}: {
  months: string[];
  rows: GridRow[];
  currency: string;
}) {
  // Reorder optimistically — a drag updates this local copy immediately;
  // `rows` (from the server) wins once it's revalidated.
  const [localRows, setLocalRows] = useState(rows);
  useEffect(() => {
    setLocalRows(rows);
  }, [rows]);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [, startReorder] = useTransition();

  const dragAccount = useRef<{ section: GridRow["section"]; accountId: string } | null>(null);
  const dragBucket = useRef<{ parentId: string; bucketId: string } | null>(null);
  // The row currently under the pointer while dragging — drives the drop
  // highlight. Each <tr> carries a `data-drop-key` of "account:<id>" or
  // "bucket:<id>" that this is matched against.
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  function trackPointerDrag(onDropKey: (kind: string, id: string) => void) {
    document.body.style.cursor = "grabbing";
    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const rowEl = el?.closest<HTMLElement>("tr[data-drop-key]");
      setDragOverKey(rowEl?.getAttribute("data-drop-key") ?? null);
    };
    const onUp = (e: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      setDragOverKey(null);
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const rowEl = el?.closest<HTMLElement>("tr[data-drop-key]");
      const key = rowEl?.getAttribute("data-drop-key");
      if (key) {
        const sep = key.indexOf(":");
        onDropKey(key.slice(0, sep), key.slice(sep + 1));
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const startAccountDrag = (section: GridRow["section"], accountId: string) => {
    dragAccount.current = { section, accountId };
    trackPointerDrag((kind, id) => {
      if (kind === "account") dropAccount(section, id);
    });
  };

  const startBucketDrag = (parentId: string, bucketId: string) => {
    dragBucket.current = { parentId, bucketId };
    trackPointerDrag((kind, id) => {
      if (kind === "bucket") dropBucket(parentId, id);
    });
  };

  // Group a section's rows into per-account blocks (account row + its
  // buckets/Unallocated row, in order) — shared by the drag drop and the
  // click-to-reorder arrows below.
  const getAccountBlocks = (section: GridRow["section"]) => {
    const blocks: { accountId?: string; rows: GridRow[] }[] = [];
    for (const r of localRows.filter((row) => row.section === section)) {
      if (!r.indent) blocks.push({ accountId: r.accountId, rows: [r] });
      else blocks[blocks.length - 1]?.rows.push(r);
    }
    return blocks;
  };

  const persistAccountOrder = (
    section: GridRow["section"],
    reordered: { accountId?: string; rows: GridRow[] }[],
  ) => {
    const newSectionRows = reordered.flatMap((b) => b.rows);
    setLocalRows((prev) => [...newSectionRows, ...prev.filter((r) => r.section !== section)]);

    const orderedIds = reordered.map((b) => b.accountId).filter((id): id is string => !!id);
    const fd = new FormData();
    fd.set("orderedIds", JSON.stringify(orderedIds));
    startReorder(async () => {
      const res = await reorderAccounts(fd);
      setReorderError(res?.error ?? null);
    });
  };

  // Move an account (and its buckets/Unallocated row, as a block) to sit
  // where another account in the same section was dropped.
  const dropAccount = (section: GridRow["section"], targetAccountId: string) => {
    const dragged = dragAccount.current;
    dragAccount.current = null;
    if (!dragged || dragged.section !== section || dragged.accountId === targetAccountId) return;

    const blocks = getAccountBlocks(section);
    const fromIdx = blocks.findIndex((b) => b.accountId === dragged.accountId);
    const toIdx = blocks.findIndex((b) => b.accountId === targetAccountId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...blocks];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    persistAccountOrder(section, reordered);
  };

  const persistBucketOrder = (parentId: string, reordered: GridRow[]) => {
    setLocalRows((prev) => {
      let i = 0;
      return prev.map((r) => (r.parentId === parentId && r.bucketId ? reordered[i++] : r));
    });

    const orderedIds = reordered.map((r) => r.bucketId).filter((id): id is string => !!id);
    const fd = new FormData();
    fd.set("orderedIds", JSON.stringify(orderedIds));
    startReorder(async () => {
      const res = await reorderBuckets(fd);
      setReorderError(res?.error ?? null);
    });
  };

  // Move a bucket to sit where another bucket under the same account was
  // dropped — the account's Unallocated row stays put underneath.
  const dropBucket = (parentId: string, targetBucketId: string) => {
    const dragged = dragBucket.current;
    dragBucket.current = null;
    if (!dragged || dragged.parentId !== parentId || dragged.bucketId === targetBucketId) return;

    const bucketRows = localRows.filter((r) => r.parentId === parentId && r.bucketId);
    const fromIdx = bucketRows.findIndex((r) => r.bucketId === dragged.bucketId);
    const toIdx = bucketRows.findIndex((r) => r.bucketId === targetBucketId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...bucketRows];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    persistBucketOrder(parentId, reordered);
  };

  const sections = SECTION_ORDER.map((section) => ({
    section,
    rows: localRows.filter((r) => r.section === section),
  })).filter((g) => g.rows.length > 0);

  // Sections start collapsed on a fresh login, but stay as you left them
  // while you're navigating around the app in that same browser session.
  const [collapsed, setCollapsed] = useSessionCollapse("networth-grid-sections", () =>
    Object.fromEntries(SECTION_ORDER.map((s) => [s, true])),
  );
  const toggle = (section: string) =>
    setCollapsed((c) => ({ ...c, [section]: !c[section] }));
  const allOpen = sections.every((g) => !collapsed[g.section]);
  const toggleAll = () =>
    setCollapsed(Object.fromEntries(sections.map((g) => [g.section, allOpen])));

  const [collapsedAccounts, setCollapsedAccounts] = useSessionCollapse(
    "networth-grid-accounts",
    () => ({}),
  );
  const toggleAccount = (id: string) =>
    setCollapsedAccounts((c) => ({ ...c, [id]: !c[id] }));

  // Per-section, per-month subtotal — top-level rows only, so bucket rows
  // and the Unallocated remainder aren't double-counted.
  const sectionTotal = (g: (typeof sections)[number], i: number) => {
    let sum = 0;
    let any = false;
    for (const r of g.rows) {
      if (r.indent) continue;
      const v = r.balances[i];
      if (v == null) continue;
      any = true;
      sum += v;
    }
    return any ? sum : null;
  };

  const readCell = (r: GridRow, i: number) => {
    const v = r.balances[i];
    if (v == null) return <span className="text-muted">—</span>;
    return (
      <span className={r.liability && v > 0 ? "text-negative" : ""}>
        {formatMoney(v, currency)}
      </span>
    );
  };

  const nameCls = (r: GridRow) =>
    r.muted
      ? "italic font-normal text-muted"
      : r.indent
        ? "font-normal text-foreground"
        : "font-medium";

  // Applied to the whole <tr> AND to the sticky name cell — the sticky cell
  // needs its own opaque-enough background to mask month cells scrolling
  // under it, so it can't just inherit the row's bg; it has to repeat it.
  // A bucket row gets a subtle indent tint; no alternating zebra otherwise —
  // it read as a distracting green wash (see feedback: "looks horrible").
  const zebraBg = (r: GridRow) => (r.indent ? "bg-background/30" : "");

  const stickyCls = "sticky left-0 pr-3";
  const hasUnallocated = localRows.some((r) => r.muted);

  // A handful of months fills the card width evenly (Account column gets the
  // rest); once there are more than that, fixed compact columns + horizontal
  // scroll reads better than squeezing everything to fit.
  const wideLayout = months.length > 0 && months.length <= 6;
  const acctPct = wideLayout ? Math.max(35, 70 - months.length * 8) : null;
  const monthPct = wideLayout && acctPct != null ? (100 - acctPct) / months.length : null;

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-2.5">
        <div>
          <h2 className="font-semibold">Monthly balances</h2>
          <p className="text-xs text-muted">
            Type a balance in any cell to record it for that month. Editing the current
            month also updates Accounts; past months are history.
          </p>
        </div>
        <button
          type="button"
          onClick={toggleAll}
          className="shrink-0 whitespace-nowrap rounded-lg bg-surface px-3 py-1.5 text-xs font-medium text-brand shadow-sm ring-1 ring-black/10 transition hover:bg-brand-soft dark:ring-white/15"
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {reorderError ? (
        <p className="border-b border-line px-4 py-1.5 text-xs font-medium text-negative">{reorderError}</p>
      ) : null}
      <div className="overflow-x-auto">
        <table className={`border-collapse text-sm ${wideLayout ? "w-full table-fixed" : ""}`}>
          {wideLayout ? (
            <colgroup>
              <col style={{ width: `${acctPct}%` }} />
              {months.map((m) => (
                <col key={m} style={{ width: `${monthPct}%` }} />
              ))}
            </colgroup>
          ) : null}
          <thead>
            <tr className="border-b border-line">
              <th className={`${stickyCls} bg-surface ${wideLayout ? "" : "min-w-[14rem]"} px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted`}>
                Account
              </th>
              {months.map((m) => (
                <th key={m} className={`${wideLayout ? "" : "w-28"} whitespace-nowrap px-3 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted`}>
                  {monthLabel(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map((g, gi) => {
              const isOpen = !collapsed[g.section];
              const accountCount = g.rows.filter((r) => !r.indent).length;
              // Kids Funding is the kids' money, excluded from every total —
              // a divider row (matching the Accounts page) makes that visually
              // clear instead of it just blending into the sections above it.
              const prevSection = sections[gi - 1]?.section;
              const showKidsDivider = g.section === "Kids Funding" && prevSection !== "Kids Funding";
              return (
                <Fragment key={g.section}>
                  {showKidsDivider ? (
                    <tr>
                      <td colSpan={months.length + 1} className="bg-background px-4 py-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                          Not counted in net worth
                        </span>
                      </td>
                    </tr>
                  ) : null}
                  <tr className="border-b border-line bg-brand-soft/50 dark:bg-brand-soft/15">
                    <td className="sticky left-0 z-10 bg-brand-soft/50 pr-3 p-0 dark:bg-brand-soft/15">
                      <button
                        type="button"
                        onClick={() => toggle(g.section)}
                        aria-expanded={isOpen}
                        className="flex w-full items-center gap-1.5 px-4 py-2 text-left transition hover:bg-brand-soft/70 dark:hover:bg-brand-soft/25"
                      >
                        <svg
                          width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                          className={`shrink-0 text-brand transition-transform ${isOpen ? "rotate-90" : ""}`}
                          aria-hidden
                        >
                          <path d="M9 6l6 6-6 6" />
                        </svg>
                        <span className="text-sm font-bold uppercase tracking-wider text-foreground">
                          {g.section}
                        </span>
                        <span className="text-xs font-normal normal-case text-muted">
                          {accountCount} {accountCount === 1 ? "account" : "accounts"}
                        </span>
                      </button>
                    </td>
                    {months.map((m, i) => {
                      const total = sectionTotal(g, i);
                      const isLiabilitySection = g.rows[0]?.liability ?? false;
                      return (
                        <td key={m} className="whitespace-nowrap px-3 py-2 text-center text-sm font-bold tabular-nums">
                          {total == null ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <span className={isLiabilitySection && total > 0 ? "text-negative" : ""}>
                              {formatMoney(total, currency)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {isOpen
                    ? g.rows
                        .filter((r) => !r.parentId || !collapsedAccounts[r.parentId])
                        .map((r, ri) => {
                          const accountOpen = !r.id || !collapsedAccounts[r.id];
                          const dropKey = r.accountId
                            ? `account:${r.accountId}`
                            : r.bucketId
                              ? `bucket:${r.bucketId}`
                              : undefined;
                          return (
                            <tr
                              key={`${g.section}-${ri}-${r.name}`}
                              data-drop-key={dropKey}
                              className={`border-b border-line ${zebraBg(r)} ${
                                r.linked || r.excluded ? "opacity-50" : ""
                              } ${
                                dropKey && dragOverKey === dropKey ? "outline outline-2 -outline-offset-2 outline-brand" : ""
                              }`}
                            >
                              <td
                                className={`${stickyCls} ${zebraBg(r) || "bg-surface"} whitespace-nowrap ${
                                  r.hasChildren
                                    ? "p-0"
                                    : r.indent
                                      ? "py-2 pl-9 text-[0.9375rem]"
                                      : "px-4 py-2"
                                } ${nameCls(r)}`}
                                title={r.muted ? "Account balance minus its bucket totals — the part not parked in a named bucket." : undefined}
                              >
                                {r.hasChildren && r.id ? (
                                  <div className="flex items-center gap-1 px-4 py-2">
                                    {r.accountId ? (
                                      <GripHandle
                                        title="Drag to reorder"
                                        onMouseDown={() => startAccountDrag(g.section, r.accountId!)}
                                      />
                                    ) : null}
                                    <button
                                      type="button"
                                      onClick={() => toggleAccount(r.id!)}
                                      aria-expanded={accountOpen}
                                      title={accountOpen ? "Collapse buckets" : "Show buckets"}
                                      className="flex shrink-0 items-center rounded p-0.5 text-muted transition hover:bg-background/60"
                                    >
                                      <svg
                                        width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                        strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
                                        className={`shrink-0 transition-transform ${accountOpen ? "rotate-90" : ""}`}
                                        aria-hidden
                                      >
                                        <path d="M9 6l6 6-6 6" />
                                      </svg>
                                    </button>
                                    {r.accountId ? (
                                      <GridNameCell id={r.accountId} name={r.name} rename={renameAccount} />
                                    ) : (
                                      <span className="min-w-0 truncate">{r.name}</span>
                                    )}
                                    {r.bucketCount ? (
                                      <span className="shrink-0 text-[11px] text-muted">
                                        {r.bucketCount} {r.bucketCount === 1 ? "bucket" : "buckets"}
                                      </span>
                                    ) : null}
                                    {r.excluded ? <ExcludedChip /> : null}
                                  </div>
                                ) : r.accountId ? (
                                  <div className="flex min-w-0 items-center gap-1">
                                    <GripHandle
                                      title="Drag to reorder"
                                      onMouseDown={() => startAccountDrag(g.section, r.accountId!)}
                                    />
                                    <GridNameCell id={r.accountId} name={r.name} rename={renameAccount} />
                                    {r.excluded ? <ExcludedChip /> : null}
                                  </div>
                                ) : r.bucketId ? (
                                  <div className="flex min-w-0 items-center gap-1">
                                    <GripHandle
                                      title="Drag to reorder"
                                      onMouseDown={() => startBucketDrag(r.parentId!, r.bucketId!)}
                                    />
                                    <GridNameCell id={r.bucketId} name={r.name} rename={updateBucket} />
                                  </div>
                                ) : (
                                  <>
                                    {r.name}
                                    {r.linked ? (
                                      <span className="ml-1.5 rounded bg-brand-soft px-1 py-0.5 text-[9px] font-semibold uppercase text-brand">
                                        linked
                                      </span>
                                    ) : null}
                                    {r.excluded ? <ExcludedChip /> : null}
                                  </>
                                )}
                              </td>
                              {months.map((m, i) => (
                                <td
                                  key={m}
                                  className={`whitespace-nowrap px-3 py-1 text-center tabular-nums ${
                                    r.muted ? "italic text-muted" : ""
                                  }`}
                                >
                                  {r.editable && r.accountId ? (
                                    <SnapshotCell variant="account" id={r.accountId} month={m} cents={r.balances[i]} currency={currency} />
                                  ) : r.editable && r.bucketId ? (
                                    <SnapshotCell variant="bucket" id={r.bucketId} month={m} cents={r.balances[i]} currency={currency} />
                                  ) : (
                                    readCell(r, i)
                                  )}
                                </td>
                              ))}
                            </tr>
                          );
                        })
                    : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasUnallocated || rows.some((r) => r.linked || r.excluded) ? (
        <div className="space-y-1 border-t border-line px-4 py-2 text-xs text-muted">
          {hasUnallocated ? (
            <p>
              <span className="italic">Unallocated</span> = the account&apos;s balance minus
              its buckets&apos; balances — whatever isn&apos;t parked in one of the named
              buckets below it. It should read $0.00 once every dollar has a bucket.
            </p>
          ) : null}
          {rows.some((r) => r.linked) ? (
            <p>&ldquo;Linked&rdquo; accounts are counted through their Budget debt row, not twice.</p>
          ) : null}
          {rows.some((r) => r.excluded) ? (
            <p>
              Kids Funding accounts are tracked here but excluded from every total —
              it&apos;s the kids&apos; money, not the household&apos;s.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ExcludedChip() {
  return (
    <span
      title="Kids Funding — tracked here, excluded from every total"
      className="ml-1.5 rounded bg-black/5 px-1 py-0.5 text-[9px] font-semibold uppercase text-muted dark:bg-white/10"
    >
      not counted
    </span>
  );
}

// Negative → light-red font; positive/zero → plain. No cell fills.
function negCls(v: number | null): string {
  return v != null && v < 0 ? "text-negative" : "";
}

function YearPicker({
  years,
  year,
  onYearChange,
}: {
  years: string[];
  year: string;
  onYearChange: (y: string) => void;
}) {
  // years is sorted newest-first; "all" sits at the end.
  // Left (‹) = older = higher index; Right (›) = newer = lower index.
  const allOptions = [...years, "all"];
  const idx = allOptions.indexOf(year);
  const canOlder = idx < allOptions.length - 1;
  const canNewer = idx > 0;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="Older year"
        disabled={!canOlder}
        onClick={() => canOlder && onYearChange(allOptions[idx + 1])}
        className="rounded-md p-1 text-muted transition hover:bg-fill disabled:opacity-30"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <select
        aria-label="Year"
        value={year}
        onChange={(e) => onYearChange(e.target.value)}
        className="cursor-pointer rounded-lg bg-background px-2 py-1 text-sm font-semibold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
      >
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
        <option value="all">All</option>
      </select>
      <button
        type="button"
        aria-label="Newer year"
        disabled={!canNewer}
        onClick={() => canNewer && onYearChange(allOptions[idx - 1])}
        className="rounded-md p-1 text-muted transition hover:bg-fill disabled:opacity-30"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M6 12l4-4-4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
}

// The sheet's top block, transposed: metrics as rows, the year's months as
// columns (Jan → Dec), plus a Growth column (year's latest − its January).
// Everything derived from `points`. Negatives in light-red font only.
function SummaryBlock({
  points,
  currency,
  years,
  year,
  onYearChange,
}: {
  points: MonthPoint[];
  currency: string;
  years: string[];
  year: string;
  onYearChange: (y: string) => void;
}) {
  const [summaryState, setSummaryState] = useSessionCollapse("networth-summary-block", () => ({ v: false }));
  const collapsed = !!summaryState.v;
  const setCollapsed = (fn: (v: boolean) => boolean) => setSummaryState((s) => ({ v: fn(!!s.v) }));
  const idxByMonth = new Map(points.map((p, i) => [p.month, i]));
  const cols = points.filter((p) => year === "all" || p.month.slice(0, 4) === year);
  const prevNet = (m: string) => {
    const i = idxByMonth.get(m);
    return i != null && i > 0 ? points[i - 1].net : null;
  };

  type Row = {
    label: string;
    bold?: boolean;
    pct?: boolean;
    redNeg?: boolean; // color negatives red
    growth?: boolean; // show a Growth column value (last − first)
    cell: (p: MonthPoint) => number | null;
  };
  const rows: Row[] = [
    { label: "Total Assets", growth: true, cell: (p) => p.assets },
    { label: "Total Liabilities", cell: (p) => p.liabilities },
    { label: "Total Net Worth", bold: true, redNeg: true, growth: true, cell: (p) => p.net },
    {
      label: "Change (+/-)",
      redNeg: true,
      cell: (p) => {
        const pn = prevNet(p.month);
        return pn == null ? null : p.net - pn;
      },
    },
    {
      label: "Change %",
      pct: true,
      redNeg: true,
      cell: (p) => {
        const pn = prevNet(p.month);
        return pn ? (p.net - pn) / pn : null;
      },
    },
    { label: "NW w/out Invest & Savings", growth: true, cell: (p) => p.nwWithoutInvest },
  ];

  const growthOf = (r: Row): number | null => {
    if (!r.growth || cols.length < 2) return null;
    const first = r.cell(cols[0]);
    const last = r.cell(cols[cols.length - 1]);
    return first == null || last == null ? null : last - first;
  };
  const fmt = (r: Row, v: number | null) =>
    v == null ? "—" : r.pct ? pctLabel(v) : formatMoney(v, currency);

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-2 text-left"
        >
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"
            className={`shrink-0 text-muted transition-transform ${collapsed ? "-rotate-90" : ""}`}
          >
            <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <h2 className="font-semibold">Net worth by month</h2>
        </button>
        <YearPicker years={years} year={year} onYearChange={onYearChange} />
      </div>
      {!collapsed && <div className="border-t border-line overflow-x-auto">
        <table className="w-full border-collapse whitespace-nowrap text-xs">
          <thead>
            <tr className="border-b border-line text-[10px] font-medium uppercase tracking-wide text-muted">
              <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left" />
              {cols.map((p) => (
                <th key={p.month} className="px-3 py-2 text-center">
                  {monthLabel(p.month)}
                </th>
              ))}
              <th className="border-l border-line px-3 py-2 text-center">Growth</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const g = growthOf(r);
              return (
                <tr key={r.label} className="border-b border-line last:border-0">
                  <td
                    className={`sticky left-0 z-10 bg-surface px-3 py-1.5 text-left ${
                      r.bold ? "font-bold" : "font-medium"
                    }`}
                  >
                    {r.label}
                  </td>
                  {cols.map((p) => {
                    const v = r.cell(p);
                    return (
                      <td
                        key={p.month}
                        className={`px-3 py-1.5 text-center tabular-nums ${r.bold ? "font-semibold" : ""} ${
                          r.redNeg ? negCls(v) : ""
                        }`}
                      >
                        {fmt(r, v)}
                      </td>
                    );
                  })}
                  <td className={`border-l border-line px-3 py-1.5 text-center tabular-nums ${negCls(g)}`}>
                    {r.growth ? (g == null ? "—" : formatMoney(g, currency)) : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>}
    </section>
  );
}

// The sheet's YearlyNetWorth tab: each headline figure per month. Compact by
// default (values only); "Show changes" reveals the dollar change (Δ) and the
// year-to-date % (vs. the prior December). Shares the year with SummaryBlock.
type Metric = { key: "savings" | "nwWithoutInvest" | "stocks" | "assets"; label: string };
const METRICS: Metric[] = [
  { key: "nwWithoutInvest", label: "NW w/out Invest & Savings" },
  { key: "stocks", label: "Stocks" },
  { key: "assets", label: "Total NW w/out Debt" },
];

function MonthlyAnalytics({
  points,
  currency,
  year,
}: {
  points: MonthPoint[];
  currency: string;
  year: string;
}) {
  const [showChanges, setShowChanges] = useState(true);
  const [monthlyState, setMonthlyState] = useSessionCollapse("networth-monthly-analytics", () => ({ v: false }));
  const collapsed = !!monthlyState.v;
  const setCollapsed = (fn: (v: boolean) => boolean) => setMonthlyState((s) => ({ v: fn(!!s.v) }));

  const byMonth = new Map(points.map((p) => [p.month, p]));
  const val = (p: MonthPoint | undefined, k: Metric["key"]) => (p ? p[k] : null);

  const rowsAll = points.map((p, i) => {
    const prev = i > 0 ? points[i - 1] : undefined;
    const priorDec = byMonth.get(`${parseInt(p.month.slice(0, 4), 10) - 1}-12-01`);
    const cells = METRICS.map((m) => {
      const v = p[m.key];
      const pv = val(prev, m.key);
      const dv = val(priorDec, m.key);
      const delta = pv == null ? null : v - pv;
      return {
        value: v,
        delta,
        monthlyPct: pv ? delta! / pv : null,
        ytd: dv ? (v - dv) / dv : null,
      };
    });
    return {
      month: p.month,
      cells,
      debt: p.debt,
      actualNet: p.net,
      debtRatio: p.net ? p.debt / p.net : null,
    };
  });

  const shown = rowsAll
    .filter((r) => year === "all" || r.month.slice(0, 4) === year)
    .reverse();

  // Columns per metric: 1 when compact, 4 (Current / M2M Diff / Monthly Diff / YTD) when expanded.
  const span = showChanges ? 4 : 1;

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-2 text-left"
        >
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"
            className={`shrink-0 text-muted transition-transform ${collapsed ? "-rotate-90" : ""}`}
          >
            <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <h2 className="font-semibold">Monthly Net Worth</h2>
        </button>
        {!collapsed && (
          <button
            type="button"
            onClick={() => setShowChanges((v) => !v)}
            className="rounded-lg bg-surface px-3 py-1.5 text-xs font-medium text-brand ring-1 ring-black/10 transition hover:bg-brand-soft dark:ring-white/15"
          >
            {showChanges ? "Hide changes" : "Show changes"}
          </button>
        )}
      </div>
      {!collapsed && <div className="border-t border-line overflow-x-auto">
        <table className="w-full border-collapse whitespace-nowrap text-xs">
          <thead>
            {/* Grouped metric names, centered over their columns */}
            <tr className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              <th className="sticky left-0 z-10 bg-surface px-3 pt-2 text-left" rowSpan={showChanges ? 2 : 1}>
                Month
              </th>
              {METRICS.map((m) => (
                <th key={m.key} colSpan={span} className="border-l border-line px-3 pt-2 pb-1 text-center">
                  {m.label}
                </th>
              ))}
              <th className="border-l border-line px-3 pt-2 text-center" rowSpan={showChanges ? 2 : 1}>Debt Incurred</th>
              <th className="px-3 pt-2 text-center" rowSpan={showChanges ? 2 : 1}>Actual NW</th>
              <th className="px-2 pt-2 text-center" rowSpan={showChanges ? 2 : 1}>Debt Ratio</th>
            </tr>
            {showChanges ? (
              <tr className="border-b border-line text-[9px] font-medium uppercase tracking-wide text-muted">
                {METRICS.map((m) => (
                  <Fragment key={m.key}>
                    <th className="border-l border-line px-3 pb-2 text-center">Current</th>
                    <th className="px-2 pb-2 text-center">M2M Diff</th>
                    <th className="px-2 pb-2 text-center">Monthly Diff</th>
                    <th className="px-2 pb-2 text-center">YTD</th>
                  </Fragment>
                ))}
              </tr>
            ) : (
              <tr className="border-b border-line">
                <th className="sticky left-0 z-10 bg-surface" />
                {METRICS.map((m) => (
                  <th key={m.key} className="border-l border-line" />
                ))}
                <th className="border-l border-line" />
                <th />
                <th />
              </tr>
            )}
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.month} className="border-b border-line last:border-0">
                <td className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-left font-medium">
                  {monthLabel(r.month)}
                </td>
                {r.cells.map((c, ci) => (
                  <Fragment key={ci}>
                    <td className="border-l border-line px-3 py-1.5 text-center tabular-nums">
                      {formatMoney(c.value, currency)}
                    </td>
                    {showChanges ? (
                      <>
                        <td className={`px-2 py-1.5 text-center tabular-nums ${negCls(c.delta)}`}>
                          {c.delta == null ? "—" : `${c.delta >= 0 ? "+" : ""}${formatMoney(c.delta, currency)}`}
                        </td>
                        <td className={`px-2 py-1.5 text-center tabular-nums ${negCls(c.monthlyPct)}`}>
                          {pctLabel(c.monthlyPct)}
                        </td>
                        <td className={`px-2 py-1.5 text-center tabular-nums ${negCls(c.ytd)}`}>
                          {pctLabel(c.ytd)}
                        </td>
                      </>
                    ) : null}
                  </Fragment>
                ))}
                <td className={`border-l border-line px-3 py-1.5 text-center tabular-nums ${r.debt > 0 ? "text-negative" : ""}`}>
                  {formatMoney(r.debt, currency)}
                </td>
                <td className={`px-3 py-1.5 text-center font-semibold tabular-nums ${negCls(r.actualNet)}`}>
                  {formatMoney(r.actualNet, currency)}
                </td>
                <td className="px-2 py-1.5 text-center tabular-nums text-muted">
                  {r.debtRatio == null ? "—" : `${(r.debtRatio * 100).toFixed(2)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </section>
  );
}

// Enter section-level totals for a month that predates per-account tracking —
// e.g. history migrated from a spreadsheet. Used only for months with no
// per-account snapshots (per-account data always wins). Works for any user, no
// spreadsheet required.
function HistoricalEntry({ currency }: { currency: string }) {
  const [open, setOpen] = useState(false);
  const [ym, setYm] = useState(""); // "YYYY-MM" from the month input
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const sym = currencySymbol(currency);

  const field = (name: string, label: string) => (
    <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
      {label}
      <span className="flex items-center gap-1 rounded-md bg-background px-2 py-1.5 ring-1 ring-line focus-within:ring-2 focus-within:ring-brand">
        <span className="pointer-events-none text-muted">{sym}</span>
        <input
          name={name}
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          className="min-w-0 flex-1 bg-transparent text-right text-sm tabular-nums focus:outline-none"
        />
      </span>
    </label>
  );

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-brand transition hover:bg-brand-soft/25"
        >
          <span className="text-base leading-none">+</span> Add historical data
          <span className="font-normal text-muted">— totals for a month before you tracked accounts</span>
        </button>
      ) : (
        <div className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Add historical data</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
          <p className="mb-3 text-xs text-muted">
            For months before you started entering individual accounts. Enter each
            section&apos;s total; leave a field at 0 if you don&apos;t have it. A month
            that later gets per-account data will use that instead.
          </p>
          <form
            action={(fd) =>
              start(async () => {
                const res = await setNetworthHistory(fd);
                if (res?.error) setError(res.error);
                else {
                  setError(null);
                  setOpen(false);
                  setYm("");
                }
              })
            }
            className="space-y-3"
          >
            <input type="hidden" name="month" value={ym ? `${ym}-01` : ""} />
            <label className="flex flex-col gap-1 text-xs text-muted">
              Month
              <input
                type="month"
                value={ym}
                onChange={(e) => {
                  setYm(e.target.value);
                  setError(null);
                }}
                required
                className="w-40 rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </label>
            <div className="flex flex-wrap gap-3">
              {field("savings", "Savings")}
              {field("bank", "Bank accounts")}
              {field("stocks", "Stocks / investments")}
              {field("debt", "Debt")}
            </div>
            {error ? <p className="text-xs font-medium text-negative">{error}</p> : null}
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save month"}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

function YearTable({ points, currency }: { points: MonthPoint[]; currency: string }) {
  const [yearState, setYearState] = useSessionCollapse("networth-year-table", () => ({ v: false }));
  const collapsed = !!yearState.v;
  const setCollapsed = (fn: (v: boolean) => boolean) => setYearState((s) => ({ v: fn(!!s.v) }));
  // Last snapshot of each year = that year's closing position.
  const byYear = new Map<string, MonthPoint>();
  for (const p of points) byYear.set(p.month.slice(0, 4), p);
  const years = [...byYear.entries()].sort(([a], [b]) => b.localeCompare(a));

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-2 text-left"
        >
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"
            className={`shrink-0 text-muted transition-transform ${collapsed ? "-rotate-90" : ""}`}
          >
            <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <h2 className="font-semibold">Year by year</h2>
        </button>
        {!collapsed && (
          <>
            <span className="ml-auto w-32 text-center text-[11px] font-medium uppercase tracking-wide text-muted">Net worth</span>
            <span className="w-32 text-center text-[11px] font-medium uppercase tracking-wide text-muted">Change</span>
          </>
        )}
      </div>
      {!collapsed && <ul className="divide-y divide-line border-t border-line">
        {years.map(([year, p], i) => {
          const prev = i < years.length - 1 ? years[i + 1][1] : null;
          const delta = prev ? p.net - prev.net : null;
          return (
            <li key={year} className="grid grid-cols-[4rem_1fr_8rem_8rem] items-center gap-2 px-4 py-2">
              <span className="text-sm font-semibold">{year}</span>
              <span className="text-xs text-muted">as of {monthLabel(p.month)}</span>
              <span className="text-center text-sm font-bold tabular-nums">
                {formatMoney(p.net, currency)}
              </span>
              <span
                title={delta == null ? "No prior year to compare against yet" : undefined}
                className={`text-center text-sm tabular-nums ${
                  delta == null ? "text-muted" : delta >= 0 ? "text-positive" : "text-negative"
                }`}
              >
                {delta == null ? "—" : `${delta >= 0 ? "+" : ""}${formatMoney(delta, currency)}`}
              </span>
            </li>
          );
        })}
      </ul>}
    </section>
  );
}
