import { contractName } from "@/lib/engine/catalog";
import { accountPerformance, dailyLossUsage } from "@/lib/desk/account-stats";
import { drawdownPct, maskAccountId } from "@/lib/desk/account-scope";
import { isUnresolved, type AttemptStatus } from "@/lib/desk/execution";
import { systemHealth } from "@/lib/desk/health";
import { useDesk } from "@/lib/desk/store";
import { money, pct, quoteText, signed } from "@/lib/format";
import { MODULE_IDS } from "@/lib/engine/modules";

const ATTEMPT_LABEL: Record<AttemptStatus, string> = {
  ready: "Ready",
  submitting: "Submitting",
  confirmed: "Confirmed",
  uncertain: "Uncertain",
  reconciling: "Reconciling",
  failed: "Not accepted",
  settled: "Settled",
};

export function DeskHome() {
  const journal = useDesk((s) => s.journal);
  const accounts = useDesk((s) => s.accounts);
  const accountId = useDesk((s) => s.accountId);
  const feed = useDesk((s) => s.feed);
  const trading = useDesk((s) => s.trading);
  const armDemo = useDesk((s) => s.armDemo);
  const armReal = useDesk((s) => s.armReal);
  const armedAccountId = useDesk((s) => s.armedAccountId);
  const emergency = useDesk((s) => s.emergency);
  const tradeType = useDesk((s) => s.tradeType);
  const modules = useDesk((s) => s.modules);
  const focus = useDesk((s) => s.focus);
  const ticks = useDesk((s) => s.ticks);
  const quotes = useDesk((s) => s.quotes);
  const risk = useDesk((s) => s.risk);
  const attempts = useDesk((s) => s.attempts);
  const buyHold = useDesk((s) => s.buyHold);
  const sessionResetAt = useDesk((s) => s.sessionResetAt);
  const equityPeaks = useDesk((s) => s.equityPeaks);
  const mode = useDesk((s) => s.mode);
  const batchSize = useDesk((s) => s.batchSize);
  const batchLock = useDesk((s) => s.batchLock);

  const account = accounts.find((row) => row.account_id === accountId) ?? null;
  const currency = account?.currency ?? "USD";
  const stats = accountPerformance(journal, accountId, Date.now(), sessionResetAt);
  const loss = dailyLossUsage(stats.todayPnl, risk.dailyLossLimit);
  const drawdown = account && Number.isFinite(account.balance) ? drawdownPct(equityPeaks[account.account_id], account.balance) : null;
  const symbol = focus[0] ?? null;
  const series = symbol ? (ticks[symbol] ?? []) : [];
  const quote = symbol ? quotes[symbol] : undefined;
  const ageSec = quote?.epoch ? Math.max(0, Date.now() / 1000 - quote.epoch) : null;
  const stale = feed === "live" && ageSec != null && ageSec > 20;
  const enabled = MODULE_IDS.filter((id) => modules[id]?.enabled && id !== "ensemble" && id !== "regime");
  const minSample = enabled.length ? Math.min(...enabled.map((id) => modules[id]?.minSample ?? risk.minSample)) : risk.minSample;
  const realArmed = Boolean(account?.account_type === "real" && armReal && armedAccountId === account.account_id);
  const unresolved = accountId ? attempts.filter((row) => row.accountId === accountId && isUnresolved(row.status)).length : 0;
  const health = systemHealth({
    feed,
    trading: account ? trading : "off",
    hasAccount: Boolean(account),
    accountType: account?.account_type ?? null,
    armDemo,
    armReal,
    realArmedForAccount: realArmed,
    emergency,
    tradeType,
    strategiesOn: enabled.length,
    tickCount: series.length,
    minSample,
    openCount: stats.open,
    unresolved,
    buyHold,
  });
  const mine = accountId ? attempts.filter((row) => row.accountId === accountId).slice(0, 6) : [];

  return (
    <div className="grid gap-3">
      <section className={`rounded-md border p-3 ${account?.account_type === "real" ? "border-down bg-down/10" : "border-line bg-surface"}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium">Account overview</h2>
            <p className="mt-1 text-sm text-muted">
              {account
                ? `${account.account_type === "real" ? "Real" : "Demo"} account. Figures below use only this account.`
                : "No Deriv account is selected. Nothing below is invented."}
            </p>
          </div>
          <span className={`rounded-sm border px-2 py-1 font-mono text-xs ${account?.account_type === "real" ? "border-down text-down" : account ? "border-gold text-gold" : "border-line text-muted"}`}>
            {account ? (account.account_type === "real" ? (realArmed ? "REAL ARMED" : "REAL DISARMED") : armDemo ? "DEMO ARMED" : "DEMO DISARMED") : "NOT SIGNED IN"}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Fact label="Account" value={account ? (account.account_type === "real" ? "Real" : "Demo") : "—"} />
          <Fact label="Account ID" value={account ? maskAccountId(account.account_id) : "—"} />
          <Fact label="Connection" value={account ? (trading === "live" ? "Authorized" : trading === "connecting" ? "Reconnecting" : "Not authorized") : "No account"} />
          <Fact label="Balance" value={account && Number.isFinite(account.balance) ? money(account.balance, currency) : "—"} />
          <Fact label="Currency" value={account?.currency || "—"} />
          <Fact label="Drawdown" value={drawdown == null ? "—" : pct(drawdown)} />
        </div>
        {account?.account_type === "real" && !realArmed ? (
          <p className="mt-3 text-sm text-down">Real trading is DISARMED. No real-money order will be sent from this desk.</p>
        ) : null}
        {account?.account_type === "demo" ? <p className="mt-3 text-sm text-gold">Demo balance. This is not real money.</p> : null}
      </section>

      <section className="rounded-md border border-line bg-surface p-3">
        <h2 className="text-sm font-medium">Trading performance</h2>
        <p className="mt-1 text-sm text-muted">
          {account ? "Settled contracts on the selected account only." : "Sign in to see this account's record."}{" "}
          {stats.settled === 0 && stats.unresolved === 0 ? "No completed trades yet." : "Missing profit is not counted as a loss."}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Fact label="Today's P/L" value={stats.todayPnl == null ? "—" : signed(stats.todayPnl, currency)} />
          <Fact label="Total P/L" value={stats.totalPnl == null ? "—" : signed(stats.totalPnl, currency)} />
          <Fact label="Settled" value={account ? String(stats.settled) : "—"} />
          <Fact label="Open" value={account ? String(stats.open) : "—"} />
          <Fact label="Wins" value={account && stats.settled ? String(stats.wins) : "—"} />
          <Fact label="Losses" value={account && stats.settled ? String(stats.losses) : "—"} />
          <Fact label="Win rate" value={!account ? "—" : stats.winRate == null ? "Unavailable" : pct(stats.winRate)} />
          <Fact label="Loss streak" value={stats.lossStreak == null ? "—" : String(stats.lossStreak)} />
          <Fact label="Average win" value={stats.avgWin == null ? "—" : signed(stats.avgWin, currency)} />
          <Fact label="Average loss" value={stats.avgLoss == null ? "—" : signed(stats.avgLoss, currency)} />
          <Fact
            label="Daily loss used"
            value={loss.used == null ? "—" : `${money(loss.used, currency)} of ${money(loss.limit, currency)}`}
          />
          <Fact label="Refunds" value={account && stats.settled ? String(stats.refunds) : "—"} />
        </div>
        {stats.unresolved > 0 ? (
          <p className="mt-3 text-sm text-gold">{stats.unresolved} settlement{stats.unresolved === 1 ? " is" : "s are"} unresolved and excluded from the win rate and from profit.</p>
        ) : null}
        {account && stats.wins + stats.losses === 0 && (stats.refunds > 0 || stats.unresolved > 0) ? (
          <p className="mt-3 text-sm text-muted">Win rate is unavailable until this account has a win or a loss. Refunds are counted separately and are not wins or losses.</p>
        ) : null}
        <p className="mt-3 text-sm text-muted">
          Mode {mode}. Martingale {risk.martingale ? `on, up to ${risk.martingaleSteps} steps` : "off"}.{" "}
          {batchLock ? `Batch ${batchLock.ids.length} of ${batchLock.size} on ${batchLock.label}.` : `Batch size ${batchSize}.`}{" "}
          {enabled.length ? `${enabled.length} trading ${enabled.length === 1 ? "strategy" : "strategies"} on.` : "No trading strategy is on."}
        </p>
      </section>

      <section className="rounded-md border border-line bg-surface p-3">
        <h2 className="text-sm font-medium">Market tape</h2>
        {!symbol ? (
          <p className="mt-2 text-sm text-muted">No market is selected.</p>
        ) : (
          <>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div>
                <div className="font-mono text-sm">{symbol}</div>
                <div className="font-mono text-2xl tabular-nums text-gold">{quote ? quoteText(quote.quote, quote.pip_size) : "—"}</div>
              </div>
              <div className="text-right text-sm text-muted">
                {feed === "live" ? (stale ? "Quote looks stale" : "Feed live") : feed === "connecting" ? "Reconnecting" : "Feed down"}
                <div className="font-mono text-xs">{ageSec == null ? "No tick yet" : `Last tick ${Math.round(ageSec)}s ago`}</div>
              </div>
            </div>
            <Spark prices={series.slice(-40).map((point) => point.q)} />
            <p className="mt-2 text-sm text-muted">
              {series.length < 2 ? "Waiting for prices. No movement is invented." : moveText(series.map((point) => point.q))}
              {tradeType ? ` Selected contract: ${contractName(tradeType)}.` : " No contract selected."}
            </p>
          </>
        )}
      </section>

      <section className="rounded-md border border-line bg-surface p-3">
        <h2 className="text-sm font-medium">System health</h2>
        <ul className="mt-2 grid gap-2">
          {health.map((row) => (
            <li key={row.id} className="flex items-start gap-2 text-sm">
              <span className={`mt-1 size-2 shrink-0 rounded-full ${row.ok ? "bg-up" : "bg-down"}`} aria-hidden />
              <span>
                <span className="font-medium">{row.label}.</span> <span className="text-muted">{row.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-md border border-line bg-surface p-3">
        <h2 className="text-sm font-medium">Execution</h2>
        <p className="mt-1 text-sm text-muted">
          Feed {feed}. Trading {account ? trading : "off"}. {unresolved} unresolved purchase{unresolved === 1 ? "" : "s"} on this account.
          {buyHold ? ` ${buyHold}` : ""} A lost response is not a completed buy.
        </p>
        {mine.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No purchase attempts for this account.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {mine.map((row) => (
              <li key={row.id} className="rounded-md border border-line px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{ATTEMPT_LABEL[row.status]}</span>
                  <span className="font-mono text-xs text-muted">{new Date(row.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                </div>
                <p className="mt-1 text-muted">
                  {row.accountType === "real" ? "Real" : "Demo"} {maskAccountId(row.accountId)} · {contractName(row.contractType)} · {money(row.stake, currency)}
                  {row.contractId ? ` · Contract ${row.contractId}` : " · No contract id yet"}
                </p>
                {row.note ? <p className="mt-1 text-fg">{row.note}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-bg px-2 py-2">
      <div className="text-xs tracking-wide text-muted uppercase">{label}</div>
      <div className="truncate font-mono text-sm tabular-nums text-fg">{value}</div>
    </div>
  );
}

function Spark({ prices }: { prices: number[] }) {
  if (prices.length < 2) return <p className="mt-2 text-sm text-muted">No price history yet.</p>;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  return (
    <div className="mt-3 flex h-12 items-end gap-px" aria-hidden>
      {prices.map((price, index) => (
        <div key={index} className="min-w-0 flex-1 rounded-sm bg-gold/80" style={{ height: `${8 + ((price - min) / span) * 92}%` }} />
      ))}
    </div>
  );
}

function moveText(prices: number[]): string {
  const first = prices[0];
  const last = prices[prices.length - 1];
  if (first == null || last == null) return "";
  const delta = last - first;
  if (delta === 0) return `Flat across ${prices.length} stored ticks.`;
  return `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} from the oldest stored tick in this window.`;
}
