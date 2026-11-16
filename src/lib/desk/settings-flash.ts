export type FlashTone = "saving" | "saved" | "failed" | "unsaved";

export type SettingsFlash = { tone: FlashTone; text: string };

let current: SettingsFlash | null = null;
const listeners = new Set<() => void>();

export function readSettingsFlash(): SettingsFlash | null {
  return current;
}

export function subscribeSettingsFlash(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSettingsFlash(next: SettingsFlash | null): void {
  current = next;
  for (const listener of listeners) listener();
}

/** Wording for a save attempt. Failed never claims the change was stored. */
export function flashText(tone: FlashTone, detail = ""): string {
  if (tone === "saving") return "Saving…";
  if (tone === "saved") return "Saved successfully.";
  if (tone === "unsaved") return "Changes not saved.";
  const extra = detail.trim();
  return extra ? `Save failed. Changes were not saved. ${extra}` : "Save failed. Changes were not saved.";
}
