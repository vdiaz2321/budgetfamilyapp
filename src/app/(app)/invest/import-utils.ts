export type ImportKind = "positions" | "performance";

export type PositionMapping = {
  symbol: string;
  securityName: string;
  quantity: string;
  price: string;
  marketValue: string;
  assetClass: string;
  costBasis: string;
  unrealizedGain: string;
  unrealizedGainPercent: string;
};

export type PerformanceMapping = {
  period: string;
  beginningBalance: string;
  marketChange: string;
  dividends: string;
  interest: string;
  contributions: string;
  withdrawals: string;
  fees: string;
  endingBalance: string;
};

export type ImportMapping = PositionMapping | PerformanceMapping;

export type ParsedCsv = {
  headers: string[];
  rows: string[][];
};

const normalizeHeader = (value: string) =>
  value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Small RFC-4180-compatible parser. Brokerage exports commonly contain quoted
// commas, blank lines, and a BOM, so a simple split(",") is not sufficient.
export function parseCsv(text: string): ParsedCsv {
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell.trim());
    if (row.some((value) => value !== "")) rows.push(row);
  }

  const headerIndex = rows.findIndex((candidate) => candidate.length >= 2);
  if (headerIndex === -1) return { headers: [], rows: [] };
  const headers = rows[headerIndex].map((value) => value.replace(/^\uFEFF/, "").trim());
  return {
    headers,
    rows: rows.slice(headerIndex + 1).filter((values) => values.some((value) => value !== "")),
  };
}

const findHeader = (headers: string[], aliases: string[]) => {
  const normalized = headers.map(normalizeHeader);
  const aliasSet = aliases.map(normalizeHeader);
  const exact = normalized.findIndex((header) => aliasSet.includes(header));
  if (exact >= 0) return headers[exact];
  const partial = normalized.findIndex((header) => aliasSet.some((alias) => header.includes(alias)));
  return partial >= 0 ? headers[partial] : "";
};

export function guessMapping(kind: ImportKind, headers: string[]): ImportMapping {
  if (kind === "positions") {
    return {
      symbol: findHeader(headers, ["symbol", "ticker", "ticker symbol"]),
      securityName: findHeader(headers, ["description", "security name", "name", "holding"]),
      quantity: findHeader(headers, ["quantity", "shares", "units"]),
      price: findHeader(headers, ["last price", "price", "current price", "market price"]),
      marketValue: findHeader(headers, ["current value", "market value", "value", "total value"]),
      assetClass: findHeader(headers, ["asset class", "asset type", "security type", "type"]),
      costBasis: findHeader(headers, ["cost basis total", "cost basis", "book value"]),
      unrealizedGain: findHeader(headers, ["total gain loss dollar", "unrealized gain loss dollar", "gain loss dollar", "gain loss"]),
      unrealizedGainPercent: findHeader(headers, ["total gain loss percent", "unrealized gain loss percent", "gain loss percent"]),
    };
  }

  return {
    period: findHeader(headers, ["monthly", "month", "period", "date"]),
    beginningBalance: findHeader(headers, ["beginning balance", "starting balance", "start balance"]),
    marketChange: findHeader(headers, ["market change", "market gain loss", "investment gain loss"]),
    dividends: findHeader(headers, ["dividends", "dividend income"]),
    interest: findHeader(headers, ["interest", "interest income"]),
    contributions: findHeader(headers, ["deposits", "contributions", "contribution", "money in"]),
    withdrawals: findHeader(headers, ["withdrawals", "withdrawal", "distributions", "money out"]),
    fees: findHeader(headers, ["net advisory fees", "fees", "advisory fees", "expense fees"]),
    endingBalance: findHeader(headers, ["ending balance", "end balance", "account value", "balance"]),
  };
}

export function columnIndex(headers: string[], column: string) {
  return column ? headers.indexOf(column) : -1;
}

export function getCell(headers: string[], row: string[], column: string) {
  const index = columnIndex(headers, column);
  return index >= 0 ? row[index] ?? "" : "";
}

export function parseMoney(value: string | undefined | null): number | null {
  if (!value) return null;
  const negative = /^\s*\(.*\)\s*$/.test(value) || /^\s*-/.test(value);
  const cleaned = value.replace(/[(),$%\s+]/g, "").replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

export function parsePercent(value: string | undefined | null): number | null {
  const parsed = parseMoney(value);
  if (parsed == null) return null;
  return value?.includes("%") ? parsed : parsed;
}

export function parseDate(value: string | undefined | null): string | null {
  if (!value) return null;
  const text = value.trim();
  const iso = text.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  const monthToken = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
  const monthYearMatches = [...text.matchAll(new RegExp(`(${monthToken})[^0-9]*(20\\d{2})`, "gi"))];
  for (const monthYear of monthYearMatches) {
    const parsed = new Date(`${monthYear[1]} 1, ${monthYear[2]}`);
    if (!Number.isNaN(parsed.getTime())) {
      const month = parsed.getMonth() + 1;
      return `${monthYear[2]}-${String(month).padStart(2, "0")}-01`;
    }
  }

  const monthDayYearMatches = [...text.matchAll(new RegExp(`(${monthToken})[^0-9]+(\\d{1,2})[^0-9]+(20\\d{2})`, "gi"))];
  for (const monthDayYear of monthDayYearMatches) {
    const parsed = new Date(`${monthDayYear[1]} 1, ${monthDayYear[3]}`);
    if (!Number.isNaN(parsed.getTime())) {
      const month = parsed.getMonth() + 1;
      return `${monthDayYear[3]}-${String(month).padStart(2, "0")}-${monthDayYear[2].padStart(2, "0")}`;
    }
  }
  return null;
}

export function parsePerformanceDate(value: string | undefined | null) {
  const asOf = value?.match(/as of\s+([A-Za-z]{3,9})[-/](\d{1,2})[-/](20\d{2})/i);
  if (asOf) return parseDate(`${asOf[1]} ${asOf[2]}, ${asOf[3]}`);
  const direct = parseDate(value);
  if (direct) return direct;
  return null;
}

export function toCents(value: number | null) {
  return value == null ? null : Math.round(value * 100);
}

export function parseQuantity(value: string | undefined | null) {
  if (!value) return null;
  const cleaned = value.replace(/[,\s]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export const POSITION_FIELDS = [
  "symbol", "securityName", "quantity", "price", "marketValue", "assetClass", "costBasis", "unrealizedGain", "unrealizedGainPercent",
] as const;

export const PERFORMANCE_FIELDS = [
  "period", "beginningBalance", "marketChange", "dividends", "interest", "contributions", "withdrawals", "fees", "endingBalance",
] as const;
