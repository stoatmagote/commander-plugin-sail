// src/lookups.ts — resolve raw game ids to names (COM-41).
//
// The generated tables (src/lookups.data.ts, built by scripts/extract_lookups)
// are bundled into the plugin, so ids resolve to names offline with no network.
// A LookupStore layers a cached/refreshed set (from ctx.storage) over that
// baseline; a failed refresh keeps whatever was already loaded.

import type { SailGame, SailHook } from "./protocol.ts";
import { BUNDLED_LOOKUPS } from "./lookups.data.ts";

export type LookupCategory = "items" | "scenes" | "actors" | "flag_types";
export const LOOKUP_CATEGORIES: readonly LookupCategory[] = [
  "items",
  "scenes",
  "actors",
  "flag_types",
];

/** game → category → id(string) → name. */
export type LookupData = Record<string, Record<string, Record<string, string>>>;

const PREFIX: Record<LookupCategory, string> = {
  items: "ITEM",
  scenes: "SCENE",
  actors: "ACTOR",
  flag_types: "FLAG",
};

/** The name shown for an id the tables don't know. */
export function hexFallback(category: LookupCategory, id: number): string {
  return `${PREFIX[category]} 0x${id.toString(16).padStart(4, "0")}`;
}

/** Hook fields that carry a lookup id, and the category that resolves each. */
const FIELD_CATEGORY: Record<string, LookupCategory> = {
  actorId: "actors",
  getItemId: "items", // SoH OnItemReceive
  itemId: "items", // 2S2H OnItemGive
  sceneNum: "scenes",
  flagType: "flag_types",
};

export interface RefreshOutcome {
  game: string;
  category: string;
  ok: boolean;
  count: number;
  error?: string;
}

export class LookupStore {
  #tables: LookupData;

  constructor(base: LookupData = BUNDLED_LOOKUPS) {
    this.#tables = structuredClone(base);
  }

  /** Resolve an id to a name, falling back to a hex label when unknown. */
  name(game: SailGame, category: LookupCategory, id: number): string {
    return this.#tables[game]?.[category]?.[String(id)] ??
      hexFallback(category, id);
  }

  /** How many entries a table has (0 if absent). */
  count(game: SailGame, category: LookupCategory): number {
    const table = this.#tables[game]?.[category];
    return table ? Object.keys(table).length : 0;
  }

  /** Replace a single table (from a refresh or a cache). */
  set(
    game: string,
    category: string,
    map: Record<string, string>,
  ): void {
    (this.#tables[game] ??= {})[category] = { ...map };
  }

  /**
   * Overlay a cached snapshot (e.g. from ctx.storage) onto the bundled tables,
   * keeping the bundled table wherever the cache has nothing. Ignores garbage.
   */
  applyCache(cached: unknown): void {
    if (!cached || typeof cached !== "object") return;
    for (const [game, cats] of Object.entries(cached as LookupData)) {
      if (!cats || typeof cats !== "object") continue;
      for (const [category, map] of Object.entries(cats)) {
        const coerced = coerceMap(map);
        if (Object.keys(coerced).length > 0) this.set(game, category, coerced);
      }
    }
  }

  /** The current tables, for persisting to ctx.storage after a refresh. */
  snapshot(): LookupData {
    return structuredClone(this.#tables);
  }

  /**
   * Re-fetch every loaded table from `<baseUrl>/<category>_<game>.json`.
   * Never throws; a failed or empty fetch leaves that table as-is, so a bad
   * refresh can't wipe working data.
   */
  async refresh(
    fetcher: (url: string) => Promise<Response>,
    baseUrl: string,
  ): Promise<RefreshOutcome[]> {
    const base = baseUrl.replace(/\/+$/, "");
    const out: RefreshOutcome[] = [];
    for (const [game, cats] of Object.entries(this.#tables)) {
      for (const category of Object.keys(cats)) {
        const url = `${base}/${category}_${game}.json`;
        try {
          const res = await fetcher(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const map = coerceMap(await res.json());
          const count = Object.keys(map).length;
          if (count === 0) throw new Error("no entries");
          this.set(game, category, map);
          out.push({ game, category, ok: true, count });
        } catch (err) {
          out.push({
            game,
            category,
            ok: false,
            count: 0,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    return out;
  }
}

/**
 * Render a hook as a one-liner, resolving its known id fields to names —
 * e.g. `OnActorInit actorId=100 (Shellblade)`.
 */
export function annotateHook(
  game: SailGame,
  hook: SailHook,
  store: LookupStore,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(hook)) {
    if (key === "type") continue;
    const category = FIELD_CATEGORY[key];
    if (category && typeof value === "number") {
      parts.push(`${key}=${value} (${store.name(game, category, value)})`);
    } else {
      parts.push(`${key}=${String(value)}`);
    }
  }
  return parts.length > 0
    ? `${hook.type} ${parts.join(" ")}`
    : String(hook.type);
}

function coerceMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = String(v);
    }
  }
  return out;
}
