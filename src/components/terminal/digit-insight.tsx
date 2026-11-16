import { explainDigits } from "@/lib/engine/modules";
import { NO_VERIFIED_EDGE } from "@/lib/engine/digit-engines";
import { contractName } from "@/lib/engine/catalog";
import { useDesk } from "@/lib/desk/store";

export function DigitInsight() {
  const focus = useDesk((s) => s.focus);
  const ticks = useDesk((s) => s.ticks);
  const quotes = useDesk((s) => s.quotes);
  const pip = useDesk((s) => s.pip);
  const tradeType = useDesk((s) => s.tradeType);
  const digitPick = useDesk((s) => s.digitPick);
  const modules = useDesk((s) => s.modules);
  const profiles = useDesk((s) => s.profiles);
  const opportunities = useDesk((s) => s.opportunities);
  const plans = useDesk((s) => s.plans);
  const symbol = focus[0] ?? null;
  const prices = symbol ? (ticks[symbol] ?? []).map((point) => point.q) : [];
  const places = symbol ? (pip[symbol] ?? quotes[symbol]?.pip_size ?? 2) : 2;
  const activePlan = plans.find((row) => row.type === tradeType && row.request?.barrier);
  const barrier = digitPick == null ? (activePlan?.request?.barrier ?? "") : String(digitPick);
  const profile = tradeType ? profiles[tradeType] : undefined;
  const quote = opportunities.find((row) => row.type === tradeType && (!symbol || row.symbol === symbol));
  const card = explainDigits(prices, places, tradeType, barrier, modules, {
    minEffective: profile?.minEffective,
    z: profile?.intervalZ,
    persist: profile?.walkForward,
    stake: quote?.stake ?? profile?.stake ?? null,
    payout: quote?.payout ?? null,
    ask: quote?.ask ?? null,
  });
  const name = tradeType ? contractName(tradeType) : "None selected";
  const max = Math.max(1, ...card.counts);

  return (
    <section className="mt-3 grid grid-cols-2 gap-2 text-sm">
      <Fact label="Even / Odd" value={`${card.even} / ${card.odd}`} />
      <Fact label="Streak" value={card.streak} />
      <Fact label="Contract" value={name} />
      <Fact label="Baseline" value={card.fair} />
      <Fact label="Observed" value={card.observed} />
      <Fact label="Estimate" value={card.estimate} />
      <Fact label="Interval" value={card.interval} />
      <Fact label="Sample" value={String(card.sample)} />
      <Fact label="Effective" value={card.effective} />
      <Fact label="Hits" value={card.hits} />
      <Fact label="Break-even" value={card.breakEven} />
      <Fact label="Ask" value={card.ask} />
      <Fact label="Payout" value={card.payout} />
      <Fact label="Expected return" value={card.expectedReturn} />
      <Fact label="Net if won" value={card.netProfit} />
      <Fact label="Loss if lost" value={card.loss} />
      <Fact label="Payout / stake" value={card.ratio} />
      <Fact label="Edge" value={NO_VERIFIED_EDGE} />
      <Fact label="Status" value={card.status} />
      <Fact label="Strategies" value={card.active} />
      <div className="col-span-2">
        <div className="text-xs tracking-wide text-muted uppercase">Frequency</div>
        <div className="mt-1 grid grid-cols-10 gap-1">
          {card.counts.map((count, digit) => (
            <div key={digit} className="min-w-0 text-center">
              <div className="mx-auto h-10 w-2 rounded-sm bg-bg">
                <div className="w-2 rounded-sm bg-gold" style={{ height: `${(count / max) * 100}%`, marginTop: `${100 - (count / max) * 100}%` }} />
              </div>
              <div className="font-mono text-xs text-muted">{digit}</div>
            </div>
          ))}
        </div>
      </div>
      <p className="col-span-2 text-sm text-pretty text-fg">{card.reason}</p>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-bg px-2 py-2">
      <div className="text-xs tracking-wide text-muted uppercase">{label}</div>
      <div className="truncate font-mono text-sm text-fg">{value}</div>
    </div>
  );
}
