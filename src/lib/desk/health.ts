export type HealthId = "market" | "trading" | "account" | "engine" | "history" | "execution" | "monitoring" | "reconcile";

export type HealthRow = {
  id: HealthId;
  label: string;
  ok: boolean;
  detail: string;
};

export type HealthInput = {
  feed: "connecting" | "live" | "down";
  trading: "off" | "connecting" | "live";
  hasAccount: boolean;
  accountType: "demo" | "real" | null;
  armDemo: boolean;
  armReal: boolean;
  realArmedForAccount: boolean;
  emergency: boolean;
  tradeType: string | null;
  strategiesOn: number;
  tickCount: number;
  minSample: number;
  openCount: number;
  unresolved: number;
  buyHold: string | null;
};

/**
 * A row is ok only when that check passed.
 * Disconnected, uncertain, or unarmed states are never reported as ready.
 */
export function systemHealth(input: HealthInput): HealthRow[] {
  const marketOk = input.feed === "live";
  const tradingOk = input.trading === "live";
  const accountOk = input.hasAccount && tradingOk;
  const engineOk = marketOk && !input.emergency;
  const needed = Math.max(0, input.minSample);
  const historyOk = input.tickCount > 0 && input.tickCount >= needed;
  const reconcileOk = input.unresolved === 0 && !input.buyHold;
  const monitoringOk = input.openCount === 0 || tradingOk;

  let executionOk = false;
  let executionDetail = "Execution is blocked.";
  if (!input.hasAccount) executionDetail = "No account is connected.";
  else if (!tradingOk) executionDetail = input.trading === "connecting" ? "Trading connection is reconnecting." : "Trading connection is down.";
  else if (input.emergency) executionDetail = "Emergency stop is on.";
  else if (!reconcileOk) executionDetail = "An unresolved purchase is still being checked.";
  else if (!input.tradeType) executionDetail = "No contract is selected.";
  else if (input.accountType === "real" && !input.realArmedForAccount) executionDetail = "Real trading is disarmed for this account.";
  else if (input.accountType === "demo" && !input.armDemo) executionDetail = "Demo trading is not armed.";
  else if (input.strategiesOn === 0) executionDetail = "No approved strategy is turned on.";
  else {
    executionOk = true;
    executionDetail = "Execution can consider a buy. Authorization gates still apply.";
  }

  return [
    {
      id: "market",
      label: "Market data",
      ok: marketOk,
      detail: marketOk ? "Public feed is live." : input.feed === "connecting" ? "Market feed is reconnecting." : "Market feed is down.",
    },
    {
      id: "trading",
      label: "Trading connection",
      ok: tradingOk,
      detail: tradingOk ? "Authorized trading socket is live." : input.trading === "connecting" ? "Trading socket is reconnecting." : "Trading socket is not connected.",
    },
    {
      id: "account",
      label: "Account authorized",
      ok: accountOk,
      detail: !input.hasAccount ? "No Deriv account is selected." : accountOk ? "This account's trading socket is authorized." : "Account is selected. Trading is not authorized yet.",
    },
    {
      id: "engine",
      label: "Strategy engine",
      ok: engineOk,
      detail: input.emergency
        ? "Emergency stop is on. New orders are blocked."
        : marketOk
          ? `${input.strategiesOn} approved ${input.strategiesOn === 1 ? "strategy is" : "strategies are"} on.`
          : "Strategy engine is not reading a live feed.",
    },
    {
      id: "history",
      label: "Historical sample",
      ok: historyOk,
      detail: historyOk ? `${input.tickCount} ticks on the analysis market.` : `${input.tickCount} ticks. ${needed} are required before a sample is sufficient.`,
    },
    {
      id: "execution",
      label: "Execution",
      ok: executionOk,
      detail: executionDetail,
    },
    {
      id: "monitoring",
      label: "Open contracts",
      ok: monitoringOk,
      detail: input.openCount === 0 ? "No open contracts on this account." : monitoringOk ? `${input.openCount} open ${input.openCount === 1 ? "contract is" : "contracts are"} monitored on this connection.` : `${input.openCount} open, not monitored while trading is disconnected.`,
    },
    {
      id: "reconcile",
      label: "Reconciliation",
      ok: reconcileOk,
      detail: reconcileOk ? "No unresolved purchase." : `${input.unresolved} unresolved. A new buy for that signal stays blocked.`,
    },
  ];
}
