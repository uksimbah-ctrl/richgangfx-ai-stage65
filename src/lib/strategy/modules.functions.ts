import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { MODULE_IDS, defaultModule, type ModuleConfig, type ModuleId } from "@/lib/engine/modules";

const Input = z.object({
  module: z.custom<ModuleConfig>(),
});

function known(id: string): id is ModuleId {
  return (MODULE_IDS as readonly string[]).includes(id);
}

export const loadStrategyModules = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await getSql();
  const rows = await sql<{ module_id: string; version: number; document: string }>`
    select module_id, version, document from strategy_module
  `;
  const modules = {} as Record<ModuleId, ModuleConfig>;
  for (const id of MODULE_IDS) modules[id] = defaultModule(id);
  for (const row of rows) {
    if (!known(row.module_id)) continue;
    try {
      modules[row.module_id] = { ...defaultModule(row.module_id), ...(JSON.parse(row.document) as ModuleConfig), id: row.module_id, version: row.version };
    } catch {
      continue;
    }
  }
  const { readModuleBook, writeModuleBook } = await import("./module-file");
  const file = await readModuleBook();
  for (const id of MODULE_IDS) {
    const disk = file[id];
    if (disk && (disk.version ?? 0) > (modules[id]?.version ?? 0)) modules[id] = disk;
  }
  try {
    await writeModuleBook(modules);
  } catch {
    // Database rows already hold the modules.
  }
  return { modules };
});

export const saveStrategyModule = createServerFn({ method: "POST" })
  .validator((raw: unknown) => Input.parse(raw))
  .handler(async ({ data }) => {
    const module = data.module;
    if (!known(module.id)) return { ok: false as const, error: "Unknown module." };
    if (module.minConfidence < 0 || module.minConfidence > 1) return { ok: false as const, error: "Confidence filter must be between 0 and 1." };
    if (module.maxLoss < 0) return { ok: false as const, error: "Loss limit cannot be negative." };
    const sql = await getSql();
    const current = await sql<{ version: number }>`
      select version from strategy_module where module_id = ${module.id}
    `;
    const version = (current[0]?.version ?? 0) + 1;
    const stored = { ...module, version };
    const document = JSON.stringify(stored);
    await sql`
      insert into strategy_module (module_id, version, document, updated_at)
      values (${module.id}, ${version}, ${document}, now())
      on conflict (module_id) do update
      set version = ${version}, document = ${document}, updated_at = now()
    `;
    const { readModuleBook, writeModuleBook } = await import("./module-file");
    const book = await readModuleBook();
    book[module.id] = stored;
    try {
      await writeModuleBook(book);
    } catch {
      // Saved in the database.
    }
    return { ok: true as const, module: stored };
  });
