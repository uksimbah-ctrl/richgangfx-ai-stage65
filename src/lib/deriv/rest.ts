import { API_BASE, type Account } from "@/lib/deriv/types";

export type CredentialKind = "pat" | "oauth";

function headers(token: string, kind: CredentialKind, appId: string): Headers {
  const h = new Headers();
  h.set("Authorization", `Bearer ${token}`);
  if (kind === "pat") h.set("Deriv-App-ID", appId);
  return h;
}

function explain(status: number, body: string): string {
  const text = body.replace(/\s+/g, " ").slice(0, 280);
  if (status === 401) return `Deriv refused the credential (401). ${text}`;
  return `Deriv account request failed (${status}). ${text}`;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function unwrapRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const row = data as Record<string, unknown>;
  if (Array.isArray(row.accounts)) return row.accounts;
  if (row.account_id || row.accountId || row.loginid) return [data];
  return [];
}

export function normalizeAccount(raw: unknown): Account | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const account_id = String(row.account_id ?? row.accountId ?? row.loginid ?? "").trim();
  if (!account_id) return null;
  const kind = String(row.account_type ?? row.accountType ?? "").toLowerCase();
  const virtual = row.is_virtual === 1 || row.is_virtual === true || row.is_virtual === "1";
  const account_type: Account["account_type"] =
    kind === "demo" || kind === "virtual" || virtual ? "demo" : "real";
  const nested = row.balance && typeof row.balance === "object" ? (row.balance as { balance?: unknown; currency?: unknown }).balance : undefined;
  const balance = asNumber(row.balance) ?? asNumber(nested);
  const currency = String(
    row.currency ?? (row.balance && typeof row.balance === "object" ? (row.balance as { currency?: unknown }).currency : "") ?? "USD",
  ).trim() || "USD";
  return {
    account_id,
    balance: balance ?? Number.NaN,
    currency,
    group: typeof row.group === "string" ? row.group : undefined,
    status: typeof row.status === "string" ? row.status : undefined,
    account_type,
  };
}

export async function fetchAccounts(
  token: string,
  kind: CredentialKind,
  appId: string,
): Promise<Account[]> {
  const res = await fetch(`${API_BASE}/trading/v1/options/accounts`, {
    headers: headers(token, kind, appId),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(explain(res.status, text));
  let json: { data?: unknown };
  try {
    json = JSON.parse(text) as { data?: unknown };
  } catch {
    throw new Error("Deriv account response was not JSON.");
  }
  const accounts = unwrapRows(json.data).map(normalizeAccount).filter((row): row is Account => row != null);
  if (accounts.length === 0) throw new Error("Deriv did not return an account list.");
  return accounts;
}

export async function fetchTradingUrl(
  token: string,
  kind: CredentialKind,
  appId: string,
  accountId: string,
): Promise<string> {
  const res = await fetch(
    `${API_BASE}/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,
    { method: "POST", headers: headers(token, kind, appId) },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(explain(res.status, text));
  let json: { data?: { url?: string } | string };
  try {
    json = JSON.parse(text) as { data?: { url?: string } | string };
  } catch {
    throw new Error("Deriv did not return a trading socket.");
  }
  const data = json.data;
  const url = typeof data === "string" ? data : data?.url;
  if (!url || !url.startsWith("wss://")) throw new Error("Deriv did not return a trading socket.");
  return url;
}