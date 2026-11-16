import { useEffect, useMemo, useState, type ReactNode } from "react";
import { contractName } from "@/lib/engine/catalog";
import { MODULE_IDS, MODULE_NAMES } from "@/lib/engine/modules";
import { maskAccountId } from "@/lib/desk/account-scope";
import { EMPTY_JOURNAL_QUERY, filterJournal, outcomeLabel, tradeOutcome, type JournalQuery } from "@/lib/desk/journal-filter";
import { useDesk } from "@/lib/desk/store";
import { money, signed } from "@/lib/format";

export function JournalPanel() {
  const journal = useDesk((s) => s.journal);
  const accountId = useDesk((s) => s.accountId);
  const [query, setQuery] = useState<JournalQuery>({ ...EMPTY_JOURNAL_QUERY });
  const [followAccount, setFollowAccount] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    if (!followAccount) return;
    setQuery((current) => ({ ...current, accountId: accountId ?? "" }));
  }, [accountId, followAccount]);
  const symbols = useMemo(() => [...new Set(journal.map((row) => row.symbol).filter(Boolean))], [journal]);
  const types = useMemo(() => [...new Set(journal.map((row) => row.contractType).filter(Boolean))], [journal]);
  const rows = filterJournal(journal, query);

  function set<K extends keyof JournalQuery>(key: K, value: JournalQuery[K]) {
    if (key === "accountId") setFollowAccount(false);
    setQuery((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="grid gap-3">
      <section className="rounded-md border border-line bg-surface p-3">
        <h2 className="text-sm font-medium">Trade journal</h2>
        <p className="mt-1 text-sm text-muted">
          Older rows with no account id stay here as Unknown account. They are not used for the selected account's profit or limits. Unresolved settlements are not losses.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Select label="Account type" value={query.accountKind} onChange={(value) => set("accountKind", value as JournalQuery["accountKind"])}>
            <option value="all">All types</option>
            <option value="demo">Demo</option>
            <option value="real">Real</option>
            <option value="unknown">Unknown account</option>
          </Select>
          <label className="block text-xs tracking-wide text-muted uppercase">
            Account ID
            <input
              value={query.accountId}
              onChange={(event) => set("accountId", event.target.value.trim())}
              placeholder={accountId ? maskAccountId(accountId) : "Exact id"}
              className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 font-mono text-sm text-fg normal-case"
            />
          </label>
          <label className="block text-xs tracking-wide text-muted uppercase">
            From
            <input type="date" value={query.from} onChange={(event) => set("from", event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-2 text-sm text-fg" />
          </label>
          <label className="block text-xs tracking-wide text-muted uppercase">
            To
            <input type="date" value={query.to} onChange={(event) => set("to", event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-2 text-sm text-fg" />
          </label>
          <Select label="Contract" value={query.contractType} onChange={(value) => set("contractType", value)}>
            <option value="">All contracts</option>
            {types.map((type) => (
              <option key={type} value={type}>
                {contractName(type)}
              </option>
            ))}
          </Select>
          <Select label="Strategy" value={query.strategy} onChange={(value) => set("strategy", value)}>
            <option value="">All strategies</option>
            {MODULE_IDS.map((id) => (
              <option key={id} value={id}>
                {MODULE_NAMES[id]}
              </option>
            ))}
          </Select>
          <Select label="Market" value={query.symbol} onChange={(value) => set("symbol", value)}>
            <option value="">All markets</option>
            {symbols.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </Select>
          <Select label="Result" value={query.outcome} onChange={(value) => set("outcome", value as JournalQuery["outcome"])}>
            <option value="all">All results</option>
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="refund">Refunded</option>
            <option value="unresolved">Unresolved</option>
          </Select>
        </div>
        <button
          type="button"
          onClick={() => {
            setFollowAccount(true);
            setQuery(accountId ? { ...EMPTY_JOURNAL_QUERY, accountId } : { ...EMPTY_JOURNAL_QUERY });
          }}
          className="mt-3 min-h-11 rounded-md border border-line px-3 text-sm"
        >
          {accountId ? "This account only" : "Clear filters"}
        </button>
      </section>
      <section className="rounded-md border border-line bg-surface p-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No trades match this filter. History is not deleted.</p>
        ) : (
          <ul className="grid gap-2">
            {rows.map((row) => {
              const outcome = tradeOutcome(row);
              const open = openId === row.id;
              return (
                <li key={row.id} className="rounded-md border border-line px-3 py-2 text-sm">
                  <button type="button" onClick={() => setOpenId(open ? null : row.id)} className="flex min-h-11 w-full items-center justify-between gap-2 text-left">
                    <span>
                      {contractName(row.contractType)}
                      <span className="mt-1 block font-mono text-xs text-muted">{when(row.openedAt)}</span>
                    </span>
                    <span className={outcome === "won" ? "font-mono text-up" : outcome === "lost" ? "font-mono text-down" : "font-mono text-muted"}>
                      {outcomeLabel(outcome)}
                      {row.profit == null ? "" : ` ${signed(row.profit, row.currency)}`}
                    </span>
                  </button>
                  {open ? (
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs text-muted">
                      <Detail k="Account" v={row.accountId ? `${row.accountType} ${maskAccountId(row.accountId)}` : "Unknown account"} />
                      <Detail k="Market" v={row.symbol || "—"} />
                      <Detail k="Stake" v={money(row.stake, row.currency)} />
                      <Detail k="Payout" v={row.payout == null ? "—" : money(row.payout, row.currency)} />
                      <Detail k="Profit" v={row.profit == null ? "Not received" : signed(row.profit, row.currency)} />
                      <Detail k="Status" v={outcomeLabel(outcome)} />
                      <Detail k="Strategy" v={row.modules?.length ? row.modules.map((id) => MODULE_NAMES[id as keyof typeof MODULE_NAMES] ?? id).join(", ") : "Not recorded"} />
                      <Detail k="Contract ID" v={row.contractId || "—"} />
                      <Detail k="Opened" v={when(row.openedAt)} />
                      <Detail k="Closed" v={row.closedAt ? when(row.closedAt) : "Still open"} />
                    </dl>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0 text-xs tracking-wide text-muted uppercase">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-2 text-sm text-fg normal-case">
        {children}
      </select>
    </label>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="uppercase">{k}</dt>
      <dd className="truncate text-fg">{v}</dd>
    </>
  );
}

function when(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
