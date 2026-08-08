export function centsToDisplay(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

export function displayToCents(value: string | number | null | undefined): number {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(/,/g, ""));
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

// Money-field calculator: accepts plain values as well as small arithmetic
// expressions such as "$1,200 + 75 - 30". It deliberately supports only
// numbers, parentheses, and + - * /; anything else falls back to the regular
// money parser rather than evaluating arbitrary JavaScript.
export function moneyExpressionToCents(value: string | number | null | undefined): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Math.round(value * 100);
  const source = value.replace(/[$€,\s]/g, "");
  if (!source || !/^[0-9.+\-*/()]+$/.test(source)) return displayToCents(value);

  let index = 0;
  const parseExpression = (): number => {
    let result = parseTerm();
    while (source[index] === "+" || source[index] === "-") {
      const operator = source[index++];
      const right = parseTerm();
      result = operator === "+" ? result + right : result - right;
    }
    return result;
  };
  const parseTerm = (): number => {
    let result = parseFactor();
    while (source[index] === "*" || source[index] === "/") {
      const operator = source[index++];
      const right = parseFactor();
      if (operator === "/" && right === 0) throw new Error("Division by zero");
      result = operator === "*" ? result * right : result / right;
    }
    return result;
  };
  const parseFactor = (): number => {
    if (source[index] === "+") {
      index++;
      return parseFactor();
    }
    if (source[index] === "-") {
      index++;
      return -parseFactor();
    }
    if (source[index] === "(") {
      index++;
      const result = parseExpression();
      if (source[index] !== ")") throw new Error("Missing parenthesis");
      index++;
      return result;
    }
    const start = index;
    while (/[0-9.]/.test(source[index] ?? "")) index++;
    const token = source.slice(start, index);
    if (!token || (token.match(/\./g)?.length ?? 0) > 1) throw new Error("Invalid number");
    const result = Number(token);
    if (!Number.isFinite(result)) throw new Error("Invalid number");
    return result;
  };

  try {
    const result = parseExpression();
    if (index !== source.length || !Number.isFinite(result)) return displayToCents(value);
    return Math.round(result * 100);
  } catch {
    return displayToCents(value);
  }
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$"
};

// Accepts either a currency code ("USD") or an already-symbol ("$").
export function currencySymbol(currency: string | null | undefined): string {
  if (!currency) return "$";
  const upper = currency.toUpperCase();
  if (CURRENCY_SYMBOLS[upper]) return CURRENCY_SYMBOLS[upper];
  // Short non-alphabetic values are treated as literal symbols already.
  return currency.length <= 2 ? currency : "$";
}

export function formatMoney(cents: number, currency = "$"): string {
  const symbol = currencySymbol(currency);
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const withCommas = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = cents < 0 ? "-" : "";
  return `${sign}${symbol}${withCommas}.${frac}`;
}
