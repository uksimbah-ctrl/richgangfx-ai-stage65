import { mergeProfile, type StrategyProfile } from "@/lib/engine/profiles";

const KEY = "richgangfx-strategy-book";

export function readLocalBook(): Record<string, StrategyProfile> | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return null;
    const parsed = JSON.parse(text) as Record<string, StrategyProfile>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLocalBook(book: Record<string, StrategyProfile>): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(book));
}

export function mergeBooks(
  base: Record<string, StrategyProfile>,
  incoming: Record<string, StrategyProfile> | null,
): Record<string, StrategyProfile> {
  const next = { ...base };
  if (!incoming) return next;
  for (const [type, profile] of Object.entries(incoming)) {
    if (!next[type]) continue;
    const current = next[type];
    if (!current) continue;
    const incomingVersion = profile.version ?? 0;
    const currentVersion = current?.version ?? 0;
    if (incomingVersion < currentVersion) continue;
    if (incomingVersion === currentVersion && current?.status === "active" && profile.status === "suspended") continue;
    next[type] = mergeProfile(current, profile);
  }
  return next;
}
