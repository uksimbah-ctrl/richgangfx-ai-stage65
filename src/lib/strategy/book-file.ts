import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CONTRACT_BY_TYPE } from "../engine/catalog.ts";
import { defaultProfile, mergeProfile, type StrategyProfile } from "../engine/profiles.ts";

export const STRATEGY_BOOK_FILE = "/workspace/data/strategy-profiles.json";

export async function readStrategyBook(file = STRATEGY_BOOK_FILE): Promise<Record<string, StrategyProfile>> {
  try {
    const text = await readFile(file, "utf8");
    const parsed = JSON.parse(text) as Record<string, StrategyProfile>;
    const book: Record<string, StrategyProfile> = {};
    for (const [type, profile] of Object.entries(parsed)) {
      if (!CONTRACT_BY_TYPE.has(type) || !profile || typeof profile !== "object") continue;
      book[type] = mergeProfile(defaultProfile(type), { ...profile, type });
    }
    return book;
  } catch {
    return {};
  }
}

export async function writeStrategyBook(book: Record<string, StrategyProfile>, file = STRATEGY_BOOK_FILE): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  try {
    await copyFile(file, `${file}.backup`);
  } catch {
    // Nothing to back up on the first save.
  }
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(book));
  await rename(tmp, file);
}
