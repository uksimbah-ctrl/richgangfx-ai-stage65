import { CONTRACT_BY_TYPE } from "@/lib/engine/catalog";
import { MODULE_IDS, MODULE_NAMES, moduleScope, moduleSupports, type ModuleId } from "@/lib/engine/modules";
import { useDesk } from "@/lib/desk/store";

export function TradeReadout() {
  const tradeType = useDesk((s) => s.tradeType);
  const modules = useDesk((s) => s.modules);
  const plans = useDesk((s) => s.plans);
  const focus = useDesk((s) => s.focus);
  const feed = useDesk((s) => s.feed);
  const trading = useDesk((s) => s.trading);
  const mode = useDesk((s) => s.mode);
  const contract = tradeType ? CONTRACT_BY_TYPE.get(tradeType) : undefined;
  const family = contract?.family;
  const enabled = MODULE_IDS.filter((id) => modules[id]?.enabled);
  const supportive = family && tradeType ? enabled.filter((id) => id !== "ensemble" && id !== "regime" && moduleSupports(id, family, tradeType)) : [];
  const blocked = family && tradeType ? enabled.filter((id) => !moduleSupports(id, family, tradeType) || id === "ensemble" || id === "regime") : [];
  const ready = tradeType ? plans.filter((plan) => plan.type === tradeType && plan.status === "pricing") : [];
  const signalIds = [...new Set(ready.flatMap((plan) => plan.modules ?? []))] as ModuleId[];

  return (
    <section className="rounded-md border border-line bg-surface p-3">
      <h2 className="text-sm font-medium">Selected trade</h2>
      <p className="mt-1 text-sm text-fg">{contract ? contract.name : "No contract selected. The bot will not buy."}</p>
      <p className="mt-1 text-sm text-muted">
        Market {focus[0] ?? "—"}. Feed {feed}. Trading socket {trading}. Mode {mode}.
      </p>
      {contract ? (
        <>
          <p className="mt-3 text-sm text-fg">
            {supportive.length
              ? `Can authorize this contract: ${supportive.map((id) => MODULE_NAMES[id]).join(", ")}.`
              : "No enabled strategy supports this contract, so no buy can be authorized."}
          </p>
          {blocked.length ? (
            <p className="mt-1 text-sm text-muted">
              On, but not an entry for this contract: {blocked.map((id) => `${MODULE_NAMES[id]} (${moduleScope(id)})`).join("; ")}.
            </p>
          ) : null}
          <p className="mt-2 text-sm text-muted">
            {signalIds.length
              ? `Latest valid signal: ${signalIds.map((id) => MODULE_NAMES[id] ?? id).join(", ")} on ${ready.map((plan) => plan.symbol).slice(0, 3).join(", ")}.`
              : ready.length
                ? "A price is ready, but no approved strategy is named on it."
                : "No valid signal for this contract right now."}
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">Pick Even, Odd, Over, Under, Matches, Differs, or another contract below.</p>
      )}
      {!supportive.length && contract ? <p className="mt-2 text-sm text-down">Unsupported strategies cannot open this trade.</p> : null}
    </section>
  );
}
