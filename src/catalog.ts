// src/catalog.ts — the spawn / give catalog (COM-50).
//
// A parametric alternative to seeding hundreds of command rows: one !spawn and
// one !give command resolve a chat-typed name against these tables. The bundled
// catalog (src/catalog.data.ts, generated from the game sources) is the
// baseline; per-entry overrides (enable/disable, price) come from ctx.storage
// and are layered on top.

import type { SailGame } from "./protocol.ts";
import { fuzzyResolve, type MatchResult } from "./fuzzy.ts";
import { BUNDLED_CATALOG } from "./catalog.data.ts";

export type ActorKind = "boss" | "enemy" | "actor";

export interface ActorEntry {
  key: string; // ACTOR_* enum name
  name: string; // matcher / display name
  kind: ActorKind;
  soh?: number; // actor id in SoH
  s2h?: number; // actor id in 2S2H
}

export interface ItemEntry {
  key: string; // ITEM_* enum name
  name: string;
  soh?: boolean;
  s2h?: boolean;
}

export interface CatalogData {
  actors: ActorEntry[];
  items: ItemEntry[];
}

/** A per-entry override the streamer sets in the Sail tab. */
export interface EntryOverride {
  enabled?: boolean;
  price?: number;
}
/** key: `actor:<KEY>` or `item:<KEY>`. */
export type Overrides = Record<string, EntryOverride>;

const DEFAULT_ACTOR_PRICE: Record<ActorKind, number> = {
  boss: 300,
  enemy: 100,
  actor: 50,
};
const DEFAULT_ITEM_PRICE = 50;

/** A grid row for the Sail tab. */
export interface CatalogRow {
  kind: "actor" | "item";
  key: string;
  name: string;
  actorKind?: ActorKind;
  games: SailGame[];
  price: number;
  defaultPrice: number;
  enabled: boolean;
}

export class Catalog {
  #actors: ActorEntry[];
  #items: ItemEntry[];
  #overrides: Overrides = {};

  constructor(base: CatalogData = BUNDLED_CATALOG) {
    this.#actors = base.actors;
    this.#items = base.items;
  }

  get actorCount(): number {
    return this.#actors.length;
  }
  get itemCount(): number {
    return this.#items.length;
  }

  /** Load the streamer's saved overrides (from ctx.storage). */
  setOverrides(overrides: unknown): void {
    this.#overrides = (overrides && typeof overrides === "object")
      ? overrides as Overrides
      : {};
  }

  overrides(): Overrides {
    return this.#overrides;
  }

  /** Patch one entry's override; returns the merged override map to persist. */
  setOverride(
    kind: "actor" | "item",
    key: string,
    patch: EntryOverride,
  ): Overrides {
    const id = `${kind}:${key}`;
    const merged = { ...this.#overrides[id], ...patch };
    // Drop keys that match the default (or were cleared) so overrides stay minimal.
    if (merged.enabled === true) delete merged.enabled;
    if (merged.price === undefined) delete merged.price;
    this.#overrides = { ...this.#overrides, [id]: merged };
    if (Object.keys(this.#overrides[id]).length === 0) {
      delete this.#overrides[id];
    }
    return this.#overrides;
  }

  #ov(kind: "actor" | "item", key: string): EntryOverride {
    return this.#overrides[`${kind}:${key}`] ?? {};
  }

  // ---- actors ----

  resolveActor(query: string): MatchResult<ActorEntry> {
    return fuzzyResolve(query, this.#actors, (e) => e.name);
  }

  actorEnabled(e: ActorEntry): boolean {
    return this.#ov("actor", e.key).enabled ?? true;
  }
  actorPrice(e: ActorEntry): number {
    return this.#ov("actor", e.key).price ?? DEFAULT_ACTOR_PRICE[e.kind];
  }
  actorGames(e: ActorEntry): SailGame[] {
    const games: SailGame[] = [];
    if (e.soh !== undefined) games.push("soh");
    if (e.s2h !== undefined) games.push("2s2h");
    return games;
  }
  actorId(e: ActorEntry, game: SailGame): number | undefined {
    return game === "soh" ? e.soh : e.s2h;
  }

  // ---- items ----

  resolveItem(query: string): MatchResult<ItemEntry> {
    return fuzzyResolve(query, this.#items, (e) => e.name);
  }

  itemEnabled(e: ItemEntry): boolean {
    return this.#ov("item", e.key).enabled ?? true;
  }
  itemPrice(e: ItemEntry): number {
    return this.#ov("item", e.key).price ?? DEFAULT_ITEM_PRICE;
  }
  itemGames(e: ItemEntry): SailGame[] {
    const games: SailGame[] = [];
    if (e.soh) games.push("soh");
    if (e.s2h) games.push("2s2h");
    return games;
  }

  // ---- grid ----

  /** Rows for the tab, optionally filtered by a search term. Capped by limit. */
  rows(kind: "actor" | "item", filter = "", limit = 200): CatalogRow[] {
    const f = filter.trim().toLowerCase();
    const out: CatalogRow[] = [];
    if (kind === "actor") {
      for (const e of this.#actors) {
        if (f && !e.name.includes(f) && !e.key.toLowerCase().includes(f)) {
          continue;
        }
        out.push({
          kind: "actor",
          key: e.key,
          name: e.name,
          actorKind: e.kind,
          games: this.actorGames(e),
          price: this.actorPrice(e),
          defaultPrice: DEFAULT_ACTOR_PRICE[e.kind],
          enabled: this.actorEnabled(e),
        });
        if (out.length >= limit) break;
      }
    } else {
      for (const e of this.#items) {
        if (f && !e.name.includes(f) && !e.key.toLowerCase().includes(f)) {
          continue;
        }
        out.push({
          kind: "item",
          key: e.key,
          name: e.name,
          games: this.itemGames(e),
          price: this.itemPrice(e),
          defaultPrice: DEFAULT_ITEM_PRICE,
          enabled: this.itemEnabled(e),
        });
        if (out.length >= limit) break;
      }
    }
    return out;
  }
}
