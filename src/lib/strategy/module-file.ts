import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { MODULE_IDS, defaultModule, type ModuleConfig, type ModuleId } from "../engine/modules.ts";

export const MODULE_BOOK_FILE = "/workspace/data/strategy-modules.json";

export async function readModuleBook(file = MODULE_BOOK_FILE): Promise<Partial<Record<ModuleId, ModuleConfig>>> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Record<string, ModuleConfig>;
    const book: Partial<Record<ModuleId, ModuleConfig>> = {};
    for (const id of MODULE_IDS) {
      const row = parsed[id];
      if (!row) continue;
      book[id] = { ...defaultModule(id), ...row, id };
    }
    return book;
  } catch {
    return {};
  }
}

export async function writeModuleBook(book: Partial<Record<ModuleId, ModuleConfig>>, file = MODULE_BOOK_FILE): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(book));
  await rename(tmp, file);
}
