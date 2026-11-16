import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { CONTRACTS } from "@/lib/engine/catalog";
import { defaultProfile, mergeProfile, validateProfile, type StrategyProfile } from "@/lib/engine/profiles";

const ProfileInput = z.object({
  profile: z.custom<StrategyProfile>(),
  action: z.enum(["save", "reset", "reactivate", "suspend", "import"]),
});

function known(type: string): boolean {
  return CONTRACTS.some((row) => row.type === type);
}

async function rowsFromDb(): Promise<Record<string, StrategyProfile>> {
  const sql = await getSql();
  const rows = await sql<{ contract_type: string; version: number; document: string }>`
    select contract_type, version, document from strategy_profile
  `;
  const profiles: Record<string, StrategyProfile> = {};
  for (const row of rows) {
    if (!known(row.contract_type)) continue;
    try {
      const parsed = JSON.parse(row.document) as StrategyProfile;
      profiles[row.contract_type] = mergeProfile(defaultProfile(row.contract_type), { ...parsed, type: row.contract_type, version: row.version });
    } catch {
      continue;
    }
  }
  return profiles;
}

function newer(a: StrategyProfile | undefined, b: StrategyProfile | undefined): StrategyProfile | undefined {
  if (!a) return b;
  if (!b) return a;
  return (b.version ?? 0) >= (a.version ?? 0) ? b : a;
}

export const loadStrategyDesk = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await getSql();
  const dbBook = await rowsFromDb();
  const { readStrategyBook, writeStrategyBook } = await import("./book-file");
  const fileBook = await readStrategyBook();
  const profiles: Record<string, StrategyProfile> = {};
  for (const type of new Set([...Object.keys(dbBook), ...Object.keys(fileBook)])) {
    const chosen = newer(dbBook[type], fileBook[type]);
    if (chosen) profiles[type] = chosen;
  }
  if (Object.keys(fileBook).length > 0 && JSON.stringify(dbBook) !== JSON.stringify(profiles)) {
    for (const profile of Object.values(profiles)) {
      const document = JSON.stringify(profile);
      await sql`
        insert into strategy_profile (contract_type, version, document, updated_at)
        values (${profile.type}, ${profile.version}, ${document}, now())
        on conflict (contract_type) do update
        set version = ${profile.version}, document = ${document}, updated_at = now()
      `;
    }
  }
  try {
    await writeStrategyBook(profiles);
  } catch {
    // The database copy is enough when the disk cannot be written.
  }
  const audit = await sql<{ id: number; contract_type: string; version: number; action: string; created_at: string }>`
    select id, contract_type, version, action, created_at::text as created_at
    from strategy_audit
    order by id desc
    limit 40
  `;
  return { profiles, audit };
});

export const saveStrategyProfile = createServerFn({ method: "POST" })
  .validator((raw: unknown) => ProfileInput.parse(raw))
  .handler(async ({ data }) => {
    const profile = data.profile;
    if (!known(profile.type)) return { ok: false as const, error: "Unknown contract." };
    const errors = validateProfile(profile);
    if (errors.length) return { ok: false as const, error: errors[0] ?? "Invalid settings." };
    const sql = await getSql();
    const current = await sql<{ version: number }>`
      select version from strategy_profile where contract_type = ${profile.type}
    `;
    const version = (current[0]?.version ?? 0) + 1;
    const stored = { ...profile, version };
    const document = JSON.stringify(stored);
    await sql`
      insert into strategy_profile (contract_type, version, document, updated_at)
      values (${profile.type}, ${version}, ${document}, now())
      on conflict (contract_type) do update
      set version = ${version}, document = ${document}, updated_at = now()
    `;
    await sql`
      insert into strategy_audit (contract_type, version, action, document)
      values (${profile.type}, ${version}, ${data.action}, ${document})
    `;
    const book = await rowsFromDb();
    try {
      const { writeStrategyBook } = await import("./book-file");
      await writeStrategyBook(book);
    } catch {
      // Saved in the database. A disk copy is optional.
    }
    return { ok: true as const, profile: stored };
  });
