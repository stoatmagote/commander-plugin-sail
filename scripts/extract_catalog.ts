// scripts/extract_catalog.ts — build the spawn / give catalogs (COM-50).
//
// Cross-matches SoH and 2S2H by ACTOR_*/ITEM_* enum name (the same creature has
// different numeric ids per game) into one catalog of spawnable actors and
// giveable items, and classifies each actor enemy / boss / other by scanning
// the actor overlay .c files for ACTORCAT_ (ported from the legacy
// generate_enemy_commands.ts). Bosses get a higher default price.
//
// Writes, from one run (so they can't drift):
//   - lookups/catalog.json   committed, human-readable
//   - src/catalog.data.ts    bundled into the plugin (offline, no network)
//
// Run:  deno task extract-catalog   (SOH_SRC / S2H_SRC override the roots)

import {
  type ActorEntry,
  extractEnumBody,
  extractEnumBodyContaining,
  parseActorTableEntries,
  parseEnum,
} from "./parsers.ts";

type Game = "soh" | "2s2h";
type Kind = "boss" | "enemy" | "actor";

interface ActorCatalogEntry {
  key: string; // ACTOR_* enum name
  name: string; // matcher/display name
  kind: Kind;
  soh?: number;
  s2h?: number;
  /** Only meaningful as another actor's child — never offered to chat. */
  requiresParent?: true;
}

/**
 * Actors that only ever exist as another actor's child.
 *
 * These are spawned with `Actor_SpawnAsChild` and read `actor.parent->…`, so a
 * standalone spawn is either a crash or a no-op. The games are patched to fail
 * safe (see the `[Sail]` guards in each overlay), but there is still nothing
 * worth spawning — so keep them out of `!spawn` entirely rather than charging a
 * viewer for an actor that removes itself. Every one of them has a spawnable
 * parent that brings it along, named here so the reason survives.
 *
 * Verified by checking that each is a SpawnAsChild target in some *other*
 * actor's file. Actors that spawn their own children (bomber jim, big poe) or
 * that guard the deref another way (poe sister, via megCloneId) are fine
 * standalone and deliberately absent.
 */
const REQUIRES_PARENT: Record<string, string> = {
  ACTOR_EN_BIGPAMET: "gekko rides it — spawn gekko",
  ACTOR_EN_MINIDEATH: "gomess's bat swarm — spawn gomess",
  ACTOR_EN_MINISLIME:
    "a piece of the fused jellies — spawn fused jellies gekko",
  ACTOR_EN_HAKUROCK: "goht's falling debris — spawn goht",
  ACTOR_EN_PART: "the body-part/gore helper, not an actor in its own right",
};
interface ItemCatalogEntry {
  key: string; // ITEM_* enum name
  name: string;
  soh?: boolean;
  s2h?: boolean;
}

const ROOTS: Record<Game, string> = {
  soh: Deno.env.get("SOH_SRC") ?? "C:/Users/pr3so/Desktop/SoH Sail/SoH-source",
  "2s2h": Deno.env.get("S2H_SRC") ??
    "C:/Users/pr3so/Desktop/SoH Sail/2S2H-gjc-source",
};
const ACTOR_TABLE: Record<Game, string> = {
  soh: "soh/include/tables/actor_table.h",
  "2s2h": "mm/include/tables/actor_table.h",
};
const ACTORS_DIR: Record<Game, string> = {
  soh: "soh/src/overlays/actors",
  "2s2h": "mm/src/overlays/actors",
};
const ITEM_HEADER: Record<Game, string> = {
  soh: "soh/include/z64item.h",
  "2s2h": "mm/include/z64item.h",
};

// --- name cleaning (ported from generate_enemy_commands.ts) ---

/** Sanitize a friendly display name into a matchable word, or null if unusable. */
function cleanName(displayName: string): string | null {
  if (/^ACTOR_/.test(displayName)) return null; // raw enum fallback — reject
  if (/^[A-Z][a-z]+_/.test(displayName)) return null; // "En_Foo" overlay name
  const cleaned = displayName
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Fallback name from an enum: ACTOR_EN_FAMOS → "famos", ITEM_BOTTLE → "bottle". */
function deriveFromEnum(enumName: string): string {
  return enumName
    .replace(/^(ACTOR|ITEM)_/, "")
    .replace(/^(EN|BOSS)_/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .trim() || enumName.toLowerCase();
}

// --- actor category scan ---

async function* walkCFiles(dir: string): AsyncGenerator<string> {
  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const e of Deno.readDir(dir)) entries.push(e);
  } catch {
    return;
  }
  for (const e of entries) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) yield* walkCFiles(p);
    else if (e.isFile && e.name.endsWith(".c")) yield p;
  }
}

/** enum name → ACTORCAT category, from the actor overlay sources. */
async function scanCategories(dir: string): Promise<Map<string, string>> {
  const cats = new Map<string, string>();
  const re = /\bACTOR_([A-Z0-9_]+)\s*,\s*(?:\/\*+\*\/\s*)?ACTORCAT_([A-Z]+)/g;
  for await (const file of walkCFiles(dir)) {
    let text: string;
    try {
      text = await Deno.readTextFile(file);
    } catch {
      continue;
    }
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) cats.set("ACTOR_" + m[1], m[2]);
  }
  return cats;
}

// --- build the actor catalog ---

async function actorsFor(
  game: Game,
): Promise<{ entries: ActorEntry[]; cats: Map<string, string> }> {
  const table = await Deno.readTextFile(`${ROOTS[game]}/${ACTOR_TABLE[game]}`);
  const entries = parseActorTableEntries(table);
  const cats = await scanCategories(`${ROOTS[game]}/${ACTORS_DIR[game]}`);
  return { entries, cats };
}

function kindOf(cat: string | undefined): Kind {
  if (cat === "BOSS") return "boss";
  if (cat === "ENEMY") return "enemy";
  return "actor";
}

async function buildActorCatalog(): Promise<ActorCatalogEntry[]> {
  const soh = await actorsFor("soh");
  const s2h = await actorsFor("2s2h");
  const byEnum = new Map<string, ActorCatalogEntry>();

  const add = (game: Game, e: ActorEntry, cat: string | undefined) => {
    const existing = byEnum.get(e.enumName);
    const kind = kindOf(cat);
    if (existing) {
      existing[game === "soh" ? "soh" : "s2h"] = e.id;
      // Prefer the "strongest" classification either game reports.
      if (kind === "boss" || (kind === "enemy" && existing.kind === "actor")) {
        existing.kind = kind;
      }
      return;
    }
    byEnum.set(e.enumName, {
      key: e.enumName,
      name: cleanName(e.displayName) ?? deriveFromEnum(e.enumName),
      kind,
      [game === "soh" ? "soh" : "s2h"]: e.id,
    });
  };

  // 2S2H first — it carries the human display names.
  for (const e of s2h.entries) add("2s2h", e, s2h.cats.get(e.enumName));
  for (const e of soh.entries) add("soh", e, soh.cats.get(e.enumName));

  for (const key of Object.keys(REQUIRES_PARENT)) {
    const entry = byEnum.get(key);
    if (entry) entry.requiresParent = true;
  }

  // A 2S2H-named entry might have kept the SoH-only clean name; re-derive from
  // the 2S2H display when we have it (add() already used it first, so we're set).
  return [...byEnum.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// --- build the item catalog ---

function itemEnum(game: Game, raw: string): Record<number, string> {
  const body = game === "soh"
    ? extractEnumBodyContaining(raw, "ITEM_BOTTLE")
    : extractEnumBody(raw, "ItemId");
  return body ? parseEnum(body) : {};
}

async function buildItemCatalog(): Promise<ItemCatalogEntry[]> {
  const byEnum = new Map<string, ItemCatalogEntry>();
  for (const game of ["2s2h", "soh"] as Game[]) {
    const raw = await Deno.readTextFile(`${ROOTS[game]}/${ITEM_HEADER[game]}`);
    for (const enumName of Object.values(itemEnum(game, raw))) {
      const entry = byEnum.get(enumName) ?? {
        key: enumName,
        name: deriveFromEnum(enumName),
      };
      entry[game === "soh" ? "soh" : "s2h"] = true;
      byEnum.set(enumName, entry);
    }
  }
  return [...byEnum.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// --- main ---

const actors = await buildActorCatalog();
const items = await buildItemCatalog();

const bosses = actors.filter((a) => a.kind === "boss").length;
const enemies = actors.filter((a) => a.kind === "enemy").length;
const both = actors.filter((a) => a.soh !== undefined && a.s2h !== undefined)
  .length;

const catalog = { actors, items };
await Deno.mkdir("lookups", { recursive: true });
await Deno.writeTextFile(
  "lookups/catalog.json",
  JSON.stringify(catalog, null, 2) + "\n",
);

const generatedAt = new Date().toISOString();
await Deno.writeTextFile(
  "src/catalog.data.ts",
  `// GENERATED by scripts/extract_catalog.ts — do not edit by hand.
// Run \`deno task extract-catalog\` to regenerate from the game source trees.

import type { CatalogData } from "./catalog.ts";

export const CATALOG_GENERATED_AT = ${JSON.stringify(generatedAt)};

export const BUNDLED_CATALOG: CatalogData = ${JSON.stringify(catalog, null, 2)};
`,
);

console.log(
  `✓ actors: ${actors.length} (${bosses} boss, ${enemies} enemy, ${both} in both games)`,
);
console.log(`✓ items:  ${items.length}`);
console.log(`✓ lookups/catalog.json + src/catalog.data.ts (${generatedAt})`);
