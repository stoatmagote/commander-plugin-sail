// src/catalog.ts — the spawn / give catalog (COM-50).
//
// A parametric alternative to seeding hundreds of command rows: one !spawn and
// one !give command resolve a chat-typed name against these tables. The bundled
// catalog (src/catalog.data.ts, generated from the game sources) is the
// baseline; per-entry overrides (enable/disable, price) come from ctx.storage
// and are layered on top.
//
// Since COM-59 the catalog is published to Commander as two option lists, and
// the commands themselves are ordinary (default) commands — so the matching,
// pricing, charging and refunding all happen in the engine and this file is
// just the data behind them.

import type { ChoiceOption } from "@twitch-commander/plugin";
import type { SailGame } from "./protocol.ts";
import { fuzzyResolve, type MatchResult, normalize } from "./fuzzy.ts";
import { BUNDLED_CATALOG } from "./catalog.data.ts";

export type ActorKind = "boss" | "enemy" | "actor";

export interface ActorEntry {
  key: string; // ACTOR_* enum name
  name: string; // matcher / display name
  kind: ActorKind;
  soh?: number; // actor id in SoH
  s2h?: number; // actor id in 2S2H
  /** Baseline spawn distance for this actor; see actorDistance(). */
  distance?: number;
  /** Other things a viewer might type for it ("chicken" for a cucco). */
  aliases?: string[];
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
  /** Actors only: how far in front of the player `safespawn` puts it. */
  distance?: number;
  /**
   * Actors only: replaces the catalog's aliases rather than adding to them, so
   * the streamer can remove a bundled alias they don't want.
   */
  aliases?: string[];
}
/** key: `actor:<KEY>` or `item:<KEY>`. */
export type Overrides = Record<string, EntryOverride>;

const DEFAULT_ACTOR_PRICE: Record<ActorKind, number> = {
  boss: 300,
  enemy: 100,
  actor: 50,
};
const DEFAULT_ITEM_PRICE = 50;
/**
 * Matches `safespawn`'s own default in both games, so leaving every actor alone
 * changes nothing — the point of the per-actor value is that a few need room
 * (a big boss landing 120 units away is already on top of you).
 */
export const DEFAULT_ACTOR_DISTANCE = 120;

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
  /** Actors only — items aren't spawned, so they have no distance. */
  distance?: number;
  defaultDistance?: number;
  /** Actors only — other names this entry answers to. */
  aliases?: string[];
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
    if (merged.distance === undefined) delete merged.distance;
    // An empty list is kept, unlike the other fields: it's how "this entry has
    // no aliases" is told apart from "no opinion, use the catalog's".
    if (merged.aliases === undefined) delete merged.aliases;
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

  /** Exact lookup by catalog key — how a resolved command argument arrives. */
  actorByKey(key: string): ActorEntry | undefined {
    const k = (key ?? "").trim().toUpperCase();
    return this.#actors.find((e) => e.key.toUpperCase() === k);
  }

  /**
   * The enabled actors as options for a command argument (COM-57). The value is
   * the catalog key rather than an id, because the same actor is numbered
   * differently in each game — sail.spawn resolves it per game. Each carries
   * its price, so `!spawn ganon` costs what the grid says it costs, and its
   * spawn distance as `meta.distance` for the step to pass to safespawn.
   *
   * Every actor carries a distance rather than only the overridden ones:
   * `{arg.actor.meta.distance}` fails the step when the chosen option doesn't
   * have the key, which is the right behaviour for a typo but would otherwise
   * break `!spawn` for every actor nobody had tuned yet.
   */
  actorOptions(): ChoiceOption[] {
    return this.#actors
      .filter((e) => this.actorEnabled(e))
      .map((e) => {
        const option: ChoiceOption = {
          value: e.key,
          label: e.name,
          cost: this.actorPrice(e),
          meta: { distance: String(this.actorDistance(e)) },
        };
        // The engine matches on these too, and still reports `label` — so
        // `!spawn chicken` spawns a cucco and says "spawned a cucco".
        const aliases = this.actorAliases(e);
        if (aliases.length > 0) option.aliases = aliases;
        return option;
      });
  }

  actorEnabled(e: ActorEntry): boolean {
    return this.#ov("actor", e.key).enabled ?? true;
  }
  actorPrice(e: ActorEntry): number {
    return this.#ov("actor", e.key).price ?? DEFAULT_ACTOR_PRICE[e.kind];
  }
  /** Streamer override, else the catalog's own value, else the game default. */
  actorDistance(e: ActorEntry): number {
    return this.#ov("actor", e.key).distance ?? e.distance ??
      DEFAULT_ACTOR_DISTANCE;
  }
  /** The names this actor also answers to (COM-64). */
  actorAliases(e: ActorEntry): string[] {
    return this.#ov("actor", e.key).aliases ?? e.aliases ?? [];
  }

  /**
   * Set an actor's aliases, refusing any that already name something else.
   *
   * Two entries answering to the same word isn't a choice the viewer can make
   * — the matcher would just pick one — so a collision is reported instead of
   * silently shadowing the other entry. Comparison is normalized, so "Dark
   * Link" and "dark-link" collide.
   */
  setActorAliases(
    key: string,
    aliases: readonly string[],
  ): { ok: true } | { ok: false; error: string } {
    const self = this.actorByKey(key);
    if (!self) return { ok: false, error: `no actor called "${key}"` };

    // What every *other* actor answers to, so we can spot a collision.
    const taken = new Map<string, string>();
    for (const other of this.#actors) {
      if (other.key === self.key) continue;
      for (const name of [other.name, ...this.actorAliases(other)]) {
        const n = normalize(name);
        if (n && !taken.has(n)) taken.set(n, other.name);
      }
    }

    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const raw of aliases) {
      const alias = String(raw ?? "").trim();
      const n = normalize(alias);
      if (!n) continue;
      // Its own name needs no alias — drop it rather than erroring, since
      // that's a harmless thing to type.
      if (n === normalize(self.name)) continue;
      if (seen.has(n)) continue;
      const clash = taken.get(n);
      if (clash) {
        return { ok: false, error: `"${alias}" already refers to ${clash}` };
      }
      seen.add(n);
      cleaned.push(alias);
    }

    // Clearing an entry that ships with aliases has to record "none" rather
    // than dropping the override, or the bundled ones come straight back and
    // removing one is impossible. Clearing an entry that had none anyway
    // stores nothing, so overrides stay minimal.
    const bundled = (self.aliases ?? []).length > 0;
    this.setOverride("actor", self.key, {
      aliases: cleaned.length > 0 || bundled ? cleaned : undefined,
    });
    return { ok: true };
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

  /** Enabled items as options. The value is the name the game's `give` takes. */
  itemOptions(): ChoiceOption[] {
    return this.#items
      .filter((e) => this.itemEnabled(e))
      .map((e) => ({ value: e.name, cost: this.itemPrice(e) }));
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
        const aliases = this.actorAliases(e);
        // Searching an alias has to find the entry, or an alias you added is
        // impossible to look up again by the word you added.
        if (
          f && !e.name.includes(f) && !e.key.toLowerCase().includes(f) &&
          !aliases.some((a) => a.toLowerCase().includes(f))
        ) {
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
          distance: this.actorDistance(e),
          defaultDistance: e.distance ?? DEFAULT_ACTOR_DISTANCE,
          aliases,
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
