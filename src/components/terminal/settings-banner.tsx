import { useSyncExternalStore } from "react";
import { readSettingsFlash, subscribeSettingsFlash } from "@/lib/desk/settings-flash";

export function SettingsBanner() {
  const flash = useSyncExternalStore(subscribeSettingsFlash, readSettingsFlash, readSettingsFlash);
  if (!flash) return null;
  const tone =
    flash.tone === "failed" || flash.tone === "unsaved" ? "text-down" : flash.tone === "saved" ? "text-up" : "text-gold";
  return (
    <p className={`mb-3 rounded-md border border-line px-3 py-2 text-sm ${tone}`} role="status">
      {flash.text}
    </p>
  );
}
