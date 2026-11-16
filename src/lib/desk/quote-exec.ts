import type { PriceRequest } from "../engine/analyze.ts";
import { streamsProposal } from "../engine/contract-check.ts";
import type { TradeMode } from "../engine/risk.ts";

/** Where the proposal was requested. A public quote is never a purchase. */
export type QuoteSource = "trading" | "public";

/**
 * Why this proposal exists.
 * `auto` and `approve` are the only intents that may buy.
 * `preview` is analysis or a price check.
 */
export type ExecutionIntent = "auto" | "approve" | "preview";

export type QuotePurchaseInput = {
  source: QuoteSource;
  intent: ExecutionIntent;
  /**
   * How the proposal arrived. Digit contracts are one-shot, so this is often false.
   * It is not permission to buy.
   */
  streaming: boolean;
  proposalId?: string | null;
  blockers: string[];
  mode: TradeMode;
  alreadyPurchased: boolean;
};

export type QuoteDecision =
  | { action: "buy"; proposalId: string; intent: "auto" | "approve" }
  | { action: "skip"; reason: string };

/**
 * Purchase authorization, separate from proposal delivery.
 * A one-time digit proposal buys when the intent is auto or approve,
 * the quote came from the trading socket, and nothing else blocks it.
 */
export function decideQuotePurchase(input: QuotePurchaseInput): QuoteDecision {
  if (input.source !== "trading") {
    return { action: "skip", reason: "A public market quote cannot be purchased." };
  }
  if (input.intent === "preview") {
    return { action: "skip", reason: "This quote was for pricing only." };
  }
  const proposalId = input.proposalId?.trim() ?? "";
  if (!proposalId) {
    return { action: "skip", reason: "The proposal has no id, so it was not purchased." };
  }
  if (input.alreadyPurchased) {
    return { action: "skip", reason: "This proposal was already purchased." };
  }
  if (input.blockers.length > 0) {
    return { action: "skip", reason: input.blockers[0] ?? "Blocked." };
  }
  if (input.intent === "auto" && input.mode !== "auto") {
    return { action: "skip", reason: "Full auto is off, so this proposal was not bought." };
  }
  if (input.intent === "approve" && input.mode !== "semi") {
    return { action: "skip", reason: "Switch to semi-auto before approving a trade." };
  }
  return { action: "buy", proposalId, intent: input.intent };
}

/** First caller wins. A repeated proposal id does not buy again. */
export function claimProposal(seen: Set<string>, proposalId: string, max = 400): boolean {
  const id = proposalId.trim();
  if (!id || seen.has(id)) return false;
  seen.add(id);
  while (seen.size > max) {
    const oldest = seen.values().next().value;
    if (!oldest || oldest === id) break;
    seen.delete(oldest);
  }
  return true;
}

/** Armed auto on a connected account. This does not itself send a buy. */
export function autoExecutionReady(input: {
  tradeType: string | null;
  mode: TradeMode;
  emergency: boolean;
  trading: "off" | "connecting" | "live";
  accountType: "demo" | "real" | null;
  accountId: string | null;
  armDemo: boolean;
  armReal: boolean;
  armedAccountId: string | null;
}): boolean {
  if (!input.tradeType) return false;
  if (input.mode !== "auto" || input.emergency || !input.accountId || input.trading !== "live") return false;
  if (input.accountType === "demo") return input.armDemo;
  if (input.accountType === "real") return input.armReal && input.armedAccountId === input.accountId;
  return false;
}

/**
 * Last check before a proposal id is sent to buy.
 * A quote from another account, a closed trading socket, or a disarmed auto session does not buy.
 */
export function purchaseStillAuthorized(input: {
  intent: "auto" | "approve";
  capturedAccountId: string;
  currentAccountId: string | null;
  socketOpen: boolean;
  emergency: boolean;
  autoReady: boolean;
}): { ok: boolean; reason: string } {
  if (!input.socketOpen) {
    return { ok: false, reason: "The trading socket is not open, so this proposal was not bought." };
  }
  if (!input.capturedAccountId || input.currentAccountId !== input.capturedAccountId) {
    return { ok: false, reason: "The account changed before this proposal could be bought." };
  }
  if (input.emergency) return { ok: false, reason: "Emergency stop is on." };
  if (input.intent === "auto" && !input.autoReady) {
    return { ok: false, reason: "Auto buy was no longer authorized when the proposal returned." };
  }
  return { ok: true, reason: "" };
}

export function buildProposalPayload(
  request: PriceRequest | undefined,
  symbol: string,
  stake: number,
  currency: string,
  subscribe: boolean,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    proposal: 1,
    amount: stake,
    basis: "stake",
    currency,
    underlying_symbol: symbol,
    contract_type: request?.contract_type,
  };
  if (request?.duration != null) payload.duration = request.duration;
  if (request?.duration_unit) payload.duration_unit = request.duration_unit;
  if (request?.barrier) payload.barrier = request.barrier;
  if (request?.barrier2) payload.barrier2 = request.barrier2;
  if (request?.multiplier != null) payload.multiplier = request.multiplier;
  if (request?.growth_rate != null) payload.growth_rate = request.growth_rate;
  if (request?.selected_tick != null) payload.selected_tick = request.selected_tick;
  if (request?.limit_order) payload.limit_order = request.limit_order;
  if (subscribe && streamsProposal(request?.contract_type)) payload.subscribe = 1;
  return payload;
}

/**
 * Runs the quote decision, then the buy callback at most once.
 * Callers still have to pass the trading socket and re-check risk before the socket buy.
 */
export async function fulfillQuote(input: {
  quote: QuotePurchaseInput;
  seen: Set<string>;
  buy: (proposalId: string, intent: "auto" | "approve") => Promise<void>;
}): Promise<QuoteDecision> {
  const decision = decideQuotePurchase(input.quote);
  if (decision.action !== "buy") return decision;
  if (!claimProposal(input.seen, decision.proposalId)) {
    return { action: "skip", reason: "This proposal was already purchased." };
  }
  await input.buy(decision.proposalId, decision.intent);
  return decision;
}
