import type { InputHTMLAttributes, ReactNode } from "react";

export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-line bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <h2 className="text-sm font-medium text-fg">{title}</h2>
        {action}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  tone = "fg",
}: {
  label: string;
  value: string;
  tone?: "fg" | "gold" | "up" | "down" | "muted";
}) {
  const color =
    tone === "gold"
      ? "text-gold"
      : tone === "up"
        ? "text-up"
        : tone === "down"
          ? "text-down"
          : tone === "muted"
            ? "text-muted"
            : "text-fg";
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-3">
      <div className="text-xs tracking-wide text-muted uppercase">{label}</div>
      <div className={`mt-1 font-mono text-lg tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

export function Btn({
  children,
  onClick,
  kind = "ghost",
  type = "button",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "gold" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const look =
    kind === "gold"
      ? "bg-gold text-gold-ink"
      : kind === "danger"
        ? "bg-down text-gold-ink"
        : "border border-line bg-raised text-fg";
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-medium ${look}`}
    >
      {children}
    </button>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`min-h-11 w-full rounded-md border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-gold ${props.className ?? ""}`}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs tracking-wide text-muted uppercase">{label}</span>
      {children}
    </label>
  );
}

export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "up" | "down" | "gold" }) {
  const look =
    tone === "up"
      ? "text-up border-up"
      : tone === "down"
        ? "text-down border-down"
        : tone === "gold"
          ? "text-gold border-gold"
          : "text-muted border-line";
  return (
    <span className={`inline-flex items-center rounded-sm border px-2 py-1 font-mono text-xs ${look}`}>
      {children}
    </span>
  );
}
