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

export function formatMoney(cents: number, currency = "$"): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const withCommas = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = cents < 0 ? "-" : "";
  return `${sign}${currency}${withCommas}.${frac}`;
}
