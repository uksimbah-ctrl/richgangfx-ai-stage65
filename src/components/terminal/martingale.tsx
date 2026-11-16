import { updateRisk } from "@/lib/desk/session";
import { useDesk } from "@/lib/desk/store";

export function MartingaleControl() {
  const risk = useDesk((s) => s.risk);
  const on = risk.martingale === true;
  return (
    <div className="mt-3 rounded-md border border-line px-3 py-3">
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
        Martingale
        <input type="checkbox" checked={on} onChange={(event) => updateRisk({ martingale: event.target.checked })} />
      </label>
      <p className="text-sm text-muted">
        {on
          ? `After a loss, stake multiplies by ${risk.martingaleMultiplier || 2}, up to ${risk.martingaleSteps || 0} steps. A win returns to the base. It cannot pass the maximum stake.`
          : "Off. Stake stays at the base amount after a loss."}
      </p>
      {on ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            Multiplier
            <input
              type="number"
              min={1}
              step={0.1}
              value={risk.martingaleMultiplier || 2}
              onChange={(event) => updateRisk({ martingaleMultiplier: Number(event.target.value) })}
              className="min-h-11 rounded-md border border-line bg-bg px-3"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Max steps
            <input
              type="number"
              min={0}
              step={1}
              value={risk.martingaleSteps || 0}
              onChange={(event) => updateRisk({ martingaleSteps: Number(event.target.value) })}
              className="min-h-11 rounded-md border border-line bg-bg px-3"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
