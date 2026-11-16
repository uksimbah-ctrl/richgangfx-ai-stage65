import { settlementStatus } from "./account-scope.ts";

export const ATTEMPT_STATUSES = ["ready", "submitting", "confirmed", "uncertain", "reconciling", "failed", "settled"] as const;

export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export type BuyAttempt = {
  id: string;
  accountId: string;
  accountType: "demo" | "real";
  contractType: string;
  symbol: string;
  stake: number;
  strategy: string;
  signalKey: string;
  at: number;
  status: AttemptStatus;
  contractId?: string;
  transactionId?: string;
  note: string;
};

export type ContractEvidence = {
  contractId: string;
  symbol: string;
  contractType: string;
  buyPrice?: number | null;
  /** Unix seconds or milliseconds. */
  purchaseTime?: number | null;
  transactionId?: string | null;
};

export type SettlementAudit = {
  profit: number | null;
  payout: number | null;
  contractStatus?: string;
  isSold?: boolean;
};

const UNRESOLVED: AttemptStatus[] = ["submitting", "uncertain", "reconciling"];

export function isUnresolved(status: AttemptStatus): boolean {
  return UNRESOLVED.includes(status);
}

export function createAttempt(input: Omit<BuyAttempt, "status" | "note"> & { note?: string }): BuyAttempt {
  return {
    ...input,
    status: "submitting",
    note: input.note ?? "Submitting purchase.",
  };
}

export function confirmAttempt(attempt: BuyAttempt, contractId: string, transactionId?: string | null): BuyAttempt {
  if (!contractId) return markUncertain(attempt, "The buy response did not include a contract id. It will be checked before another purchase.");
  if (attempt.status === "confirmed" || attempt.status === "settled") return attempt;
  return {
    ...attempt,
    status: "confirmed",
    contractId,
    transactionId: transactionId || attempt.transactionId,
    note: "Purchase confirmed.",
  };
}

export function markUncertain(attempt: BuyAttempt, note: string): BuyAttempt {
  if (attempt.status === "confirmed" || attempt.status === "settled") return attempt;
  return { ...attempt, status: "uncertain", note };
}

export function markReconciling(attempt: BuyAttempt): BuyAttempt {
  if (attempt.status === "confirmed" || attempt.status === "settled" || attempt.status === "failed") return attempt;
  return { ...attempt, status: "reconciling", note: "Checking this purchase against the account. It will not be sent again yet." };
}

export function classifyBuyError(message: string): "uncertain" | "rejected" {
  if (/timed out|socket closed|market socket failed/i.test(message)) return "uncertain";
  return "rejected";
}

/** An explicit Deriv rejection can be retried. A timeout or a dropped socket cannot. */
export function rejectPurchase(attempt: BuyAttempt, message: string): { attempt: BuyAttempt; retry: boolean } {
  const note = message.trim() || "Deriv did not accept this purchase.";
  if (classifyBuyError(note) === "uncertain") {
    return {
      attempt: markUncertain(attempt, `${note} This purchase stays unresolved and will not be sent again yet.`),
      retry: false,
    };
  }
  return { attempt: markFailed(attempt, note), retry: true };
}

export function markFailed(attempt: BuyAttempt, note: string): BuyAttempt {
  if (attempt.status === "confirmed" || attempt.status === "settled") return attempt;
  return { ...attempt, status: "failed", note };
}

export function markSettled(attempt: BuyAttempt): BuyAttempt {
  if (attempt.status !== "confirmed" && attempt.status !== "settled") return attempt;
  return { ...attempt, status: "settled", note: "Settlement recorded." };
}

export function blockingAttempt(attempts: BuyAttempt[], accountId: string | null | undefined, signalKey: string): BuyAttempt | null {
  if (!accountId) return null;
  return attempts.find((row) => row.accountId === accountId && row.signalKey === signalKey && isUnresolved(row.status)) ?? null;
}

export function slotsUsed(openCount: number, attempts: BuyAttempt[], accountId: string | null | undefined): number {
  if (!accountId) return openCount;
  const pending = attempts.filter((row) => row.accountId === accountId && isUnresolved(row.status)).length;
  return openCount + pending;
}

export function batchWouldExceed(
  lock: { key: string; ids: string[] } | null,
  signalKey: string,
  attempts: BuyAttempt[],
  accountId: string | null | undefined,
  cap: number,
): boolean {
  if (cap <= 1 || !accountId) return false;
  const pending = attempts.filter((row) => row.accountId === accountId && row.signalKey === signalKey && isUnresolved(row.status)).length;
  const confirmed = lock && lock.key === signalKey ? lock.ids.length : 0;
  return confirmed + pending >= cap;
}

export function maySubmit(attempts: BuyAttempt[], accountId: string | null | undefined, signalKey: string): { ok: boolean; reason: string } {
  const blocking = blockingAttempt(attempts, accountId, signalKey);
  if (!blocking) return { ok: true, reason: "" };
  return { ok: false, reason: blocking.note || "A purchase for this signal is still unresolved." };
}

function epochMs(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return value < 1e12 ? value * 1000 : value;
}

function sameContract(row: ContractEvidence, attempt: BuyAttempt): boolean {
  return row.contractId.length > 0 && row.symbol === attempt.symbol && row.contractType === attempt.contractType;
}

function exactTransaction(row: ContractEvidence, attempt: BuyAttempt): boolean {
  return Boolean(attempt.transactionId) && row.transactionId === attempt.transactionId;
}

/** Symbol, type, stake, and time must all agree. A partial lookalike is not a match. */
function similarMatch(row: ContractEvidence, attempt: BuyAttempt): boolean {
  if (!sameContract(row, attempt)) return false;
  const price = row.buyPrice;
  const priceOk = price != null && Number.isFinite(price) && Math.abs(price - attempt.stake) <= 0.05;
  const at = epochMs(row.purchaseTime);
  const timeOk = at != null && at >= attempt.at - 15_000 && at <= attempt.at + 180_000;
  return priceOk && timeOk;
}

export type HistoryPage = {
  rows: ContractEvidence[];
  received: number;
  limit: number;
};

/** A short page means Deriv had no further rows. A full page, or a failed request, is not proof of absence. */
export function assembleHistory(pages: HistoryPage[] | null): { rows: ContractEvidence[] | null; complete: boolean } {
  if (pages == null || pages.length === 0) return { rows: null, complete: false };
  const last = pages[pages.length - 1];
  return {
    rows: pages.flatMap((page) => page.rows),
    complete: last.received < last.limit,
  };
}

export function retainAttempt(attempt: BuyAttempt): BuyAttempt {
  if (attempt.status === "confirmed" || attempt.status === "settled" || attempt.contractId) {
    return attempt.contractId ? confirmAttempt(attempt, attempt.contractId, attempt.transactionId) : attempt;
  }
  if (attempt.status === "failed") return attempt;
  return markUncertain(
    attempt,
    "The trading socket closed before Deriv answered. This purchase stays on its original account and will not be sent again.",
  );
}

export function reconcileAttempt(input: {
  attempt: BuyAttempt;
  portfolio: ContractEvidence[] | null;
  history: ContractEvidence[] | null;
  knownIds: string[];
  now?: number;
  /** False when profit_table did not cover the attempt. Absence is then unknown, not a rejection. */
  historyComplete?: boolean;
}): { attempt: BuyAttempt; retry: boolean } {
  const current = input.attempt;
  if (current.status === "confirmed" || current.status === "settled" || current.status === "failed") {
    return { attempt: current, retry: false };
  }
  if (current.contractId) return { attempt: confirmAttempt(current, current.contractId, current.transactionId), retry: false };
  const known = new Set(input.knownIds);
  const rows = [...(input.portfolio ?? []), ...(input.history ?? [])].filter((row) => row.contractId && !known.has(row.contractId));
  const exact = current.transactionId ? unique(rows.filter((row) => exactTransaction(row, current))) : [];
  if (exact.length === 1) {
    const row = exact[0];
    return { attempt: confirmAttempt(current, row.contractId, row.transactionId), retry: false };
  }
  if (exact.length > 1) {
    return {
      attempt: markUncertain(current, "More than one contract has this transaction id. It will not be bought again until that is clear."),
      retry: false,
    };
  }
  const covered = input.portfolio != null && input.history != null && input.historyComplete !== false;
  if (current.transactionId) {
    return {
      attempt: markUncertain(
        current,
        covered
          ? "The transaction id was not in the contracts Deriv returned. It stays unresolved and will not be sent again."
          : "The transaction id could not be checked against a complete Deriv history. It stays unresolved and will not be sent again.",
      ),
      retry: false,
    };
  }
  const similar = unique(rows.filter((row) => similarMatch(row, current)));
  if (similar.length > 1) {
    return {
      attempt: markUncertain(current, "More than one contract could match this purchase. It will not be bought again until that is clear."),
      retry: false,
    };
  }
  if (similar.length === 1 && covered) {
    const row = similar[0];
    return { attempt: confirmAttempt(current, row.contractId, row.transactionId), retry: false };
  }
  const loose = rows.filter((row) => sameContract(row, current));
  if (!covered || loose.length > 0 || similar.length === 1) {
    return {
      attempt: markUncertain(
        current,
        !covered
          ? "Deriv history for this purchase is incomplete. That is not a rejection, so it stays unresolved and will not be sent again."
          : "A similar contract is open, but it could not be tied to this purchase. It will not be sent again yet.",
      ),
      retry: false,
    };
  }
  return {
    attempt: markUncertain(
      current,
      "Deriv has not listed this purchase. An empty portfolio is not a rejection, so it stays unresolved and will not be sent again.",
    ),
    retry: false,
  };
}

function unique(rows: ContractEvidence[]): ContractEvidence[] {
  const seen = new Set<string>();
  const out: ContractEvidence[] = [];
  for (const row of rows) {
    if (seen.has(row.contractId)) continue;
    seen.add(row.contractId);
    out.push(row);
  }
  return out;
}

export function addOpenContract<T extends { contractId: string; accountId: string }>(journal: T[], row: T, limit = 400): { journal: T[]; added: boolean } {
  if (journal.some((item) => item.contractId === row.contractId)) return { journal, added: false };
  return { journal: [row, ...journal].slice(0, limit), added: true };
}

export function applySettlement<
  T extends {
    status: string;
    profit?: number | null;
    payout?: number | null;
    closedAt?: number;
    note: string;
    settlement?: SettlementAudit;
  },
>(
  row: T,
  update: { sold: boolean; profit: number | null; payout: number | null; closedAt: number; audit: SettlementAudit },
): T {
  if (row.status === "won" || row.status === "lost" || row.status === "sold") return row;
  const status = settlementStatus(update.sold, update.profit);
  if (status === "open" || update.profit == null) {
    return {
      ...row,
      profit: update.profit ?? row.profit,
      settlement: update.sold ? update.audit : row.settlement,
      note: update.sold ? "Settlement did not include a profit. The trade stays open until Deriv reports it." : row.note,
    };
  }
  return {
    ...row,
    profit: update.profit,
    payout: update.payout ?? row.payout,
    status,
    closedAt: update.closedAt,
    settlement: update.audit,
    note: status === "sold" ? "Closed with no profit or loss." : row.note,
  };
}

export function restoreAttempts(saved: unknown): BuyAttempt[] {
  if (!Array.isArray(saved)) return [];
  const out: BuyAttempt[] = [];
  for (const row of saved) {
    if (!row || typeof row !== "object") continue;
    const attempt = row as Partial<BuyAttempt>;
    if (typeof attempt.id !== "string" || typeof attempt.accountId !== "string" || typeof attempt.signalKey !== "string") continue;
    if (attempt.accountType !== "demo" && attempt.accountType !== "real") continue;
    const status = attempt.status === "submitting" || attempt.status === "reconciling" ? "uncertain" : attempt.status;
    if (!status || !ATTEMPT_STATUSES.includes(status)) continue;
    out.push({
      id: attempt.id,
      accountId: attempt.accountId,
      accountType: attempt.accountType,
      contractType: String(attempt.contractType ?? ""),
      symbol: String(attempt.symbol ?? ""),
      stake: Number(attempt.stake ?? 0),
      strategy: String(attempt.strategy ?? ""),
      signalKey: attempt.signalKey,
      at: Number(attempt.at ?? 0),
      status,
      contractId: attempt.contractId,
      transactionId: attempt.transactionId,
      note:
        attempt.status === "submitting" || attempt.status === "reconciling"
          ? "The connection dropped before Deriv answered. This purchase will be checked before another one is sent."
          : String(attempt.note ?? ""),
    });
  }
  return out.slice(0, 40);
}

export function subscriptionList(rows: Array<{ contractId: string; accountId: string }>, accountId: string, already: string[] = []): string[] {
  const seen = new Set(already);
  const out: string[] = [];
  for (const row of rows) {
    if (row.accountId !== accountId || !row.contractId || seen.has(row.contractId)) continue;
    seen.add(row.contractId);
    out.push(row.contractId);
  }
  return out;
}

export function executionText(input: {
  connected: boolean;
  trading: "off" | "connecting" | "live";
  attempt: BuyAttempt | null;
  journalStatus?: string | null;
  profit?: number | null;
  pendingSettlement?: boolean;
}): string {
  if (!input.connected) return "Not connected.";
  if (input.trading === "connecting") return "Recovery in progress.";
  const attempt = input.attempt;
  const unresolved = attempt != null && isUnresolved(attempt.status);
  if (input.trading === "off") {
    return unresolved
      ? "Connection interrupted. An unresolved purchase will be checked before another buy."
      : "Connection interrupted.";
  }
  if (!attempt || attempt.status === "ready") {
    if (input.pendingSettlement) return "Settlement pending.";
    if (input.journalStatus === "open") return "Contract open.";
    return "Ready to buy.";
  }
  if (attempt.status === "submitting") return "Submitting purchase.";
  if (attempt.status === "uncertain" || attempt.status === "reconciling") {
    return "Checking uncertain purchase. The bot will not buy again until Deriv answers.";
  }
  if (attempt.status === "failed") return "The purchase was not accepted. A new buy can be considered.";
  if (input.pendingSettlement && input.journalStatus !== "won" && input.journalStatus !== "lost" && input.journalStatus !== "sold") {
    return "Settlement pending.";
  }
  if (input.journalStatus === "won" || (attempt.status === "settled" && (input.profit ?? 0) > 0)) return "Won.";
  if (input.journalStatus === "lost" || (attempt.status === "settled" && (input.profit ?? 0) < 0)) return "Lost.";
  if (input.journalStatus === "sold" || (attempt.status === "settled" && input.profit === 0)) return "Refunded or closed without profit or loss.";
  if (attempt.status === "confirmed" || input.journalStatus === "open") return "Contract open.";
  return "Settlement pending.";
}
