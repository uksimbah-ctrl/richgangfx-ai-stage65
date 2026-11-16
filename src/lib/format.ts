function finite(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function money(value: number | string | null | undefined, currency = "USD"): string {
  const n = finite(value);
  if (n == null) return "—";
  const code = /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function signed(value: number | string | null | undefined, currency = "USD"): string {
  const n = finite(value);
  if (n == null) return "—";
  const text = money(Math.abs(n), currency);
  if (n > 0) return `+${text}`;
  if (n < 0) return `−${text}`;
  return text;
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function quoteText(value: number | string, pip = 2): string {
  const n = finite(value);
  if (n == null) return "—";
  const places = pip >= 1 && pip <= 8 && Number.isInteger(pip) ? pip : 2;
  return n.toFixed(places);
}
