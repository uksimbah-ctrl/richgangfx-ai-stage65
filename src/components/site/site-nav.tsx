import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";

const LINKS = [
  { to: "/", label: "Home", hash: "" },
  { to: "/", label: "Features", hash: "features" },
  { to: "/guide", label: "How to use", hash: "" },
  { to: "/", label: "About", hash: "about" },
  { to: "/", label: "FAQ", hash: "faq" },
] as const;

export function SiteNav({ onConnect }: { onConnect: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-navy/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-md bg-gold font-mono text-xs font-semibold text-gold-ink">
            RG
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold tracking-wide">RICHGANGFX</span>
            <span className="block font-mono text-xs text-gold">AI</span>
          </span>
        </Link>
        <nav className="ml-6 hidden items-center gap-5 md:flex">
          {LINKS.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              hash={item.hash || undefined}
              className="text-sm text-muted hover:text-fg"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Link to="/desk" className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-fg">
            Open desk
          </Link>
          <button
            type="button"
            onClick={onConnect}
            className="inline-flex min-h-11 items-center rounded-md bg-blue px-3 text-sm font-semibold text-navy"
          >
            Connect to Deriv
          </button>
        </div>
        <button
          type="button"
          className="ml-auto grid size-11 place-items-center rounded-md border border-line md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
        >
          {open ? <X className="size-4" /> : <Menu className="size-4" />}
        </button>
      </div>
      {open ? (
        <div className="grid gap-1 border-t border-line px-4 py-3 md:hidden">
          {LINKS.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              hash={item.hash || undefined}
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center text-sm"
            >
              {item.label}
            </Link>
          ))}
          <Link to="/desk" onClick={() => setOpen(false)} className="flex min-h-11 items-center text-sm">
            Open desk
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onConnect();
            }}
            className="min-h-11 rounded-md bg-blue text-sm font-semibold text-navy"
          >
            Connect to Deriv
          </button>
        </div>
      ) : null}
    </header>
  );
}
