// Evaluates simple arithmetic typed into a number field ("271842-268244",
// "1,200 + 3*50"). A tiny recursive-descent parser — never `eval` — that
// accepts digits, commas, decimals, + - * / and parentheses. Returns null for
// anything it cannot fully parse, so the caller can leave the text untouched.
export function evaluateExpression(raw: string): number | null {
  const src = raw.replace(/[,\s]/g, "");
  if (!src) return null;
  let i = 0;

  const parseNumber = (): number | null => {
    const match = /^\d*\.?\d+|^\d+\.?/.exec(src.slice(i));
    if (!match) return null;
    i += match[0].length;
    return Number(match[0]);
  };
  const parseFactor = (): number | null => {
    if (src[i] === "-" || src[i] === "+") {
      const sign = src[i++] === "-" ? -1 : 1;
      const value = parseFactor();
      return value === null ? null : sign * value;
    }
    if (src[i] === "(") {
      i++;
      const value = parseSum();
      if (value === null || src[i] !== ")") return null;
      i++;
      return value;
    }
    return parseNumber();
  };
  const parseProduct = (): number | null => {
    let value = parseFactor();
    while (value !== null && (src[i] === "*" || src[i] === "/")) {
      const op = src[i++];
      const rhs = parseFactor();
      if (rhs === null) return null;
      value = op === "*" ? value * rhs : value / rhs;
    }
    return value;
  };
  function parseSum(): number | null {
    let value = parseProduct();
    while (value !== null && (src[i] === "+" || src[i] === "-")) {
      const op = src[i++];
      const rhs = parseProduct();
      if (rhs === null) return null;
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  const result = parseSum();
  return result !== null && i === src.length && Number.isFinite(result) ? result : null;
}

// True when the text holds an operator after its first character — i.e. it
// is a calculation to resolve, not a plain (possibly negative) number.
export function hasOperator(raw: string): boolean {
  return /[+\-*/()]/.test(raw.trim().slice(1));
}
