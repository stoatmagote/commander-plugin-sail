// tests/catalog_test.ts — fuzzy matching and the catalog (COM-50).

import { assert, assertEquals } from "@std/assert";
import { fuzzyResolve, normalize } from "../src/fuzzy.ts";
import { Catalog, type CatalogData } from "../src/catalog.ts";

// ---- fuzzy ----

const NAMES = ["cucco", "cucco chick", "attacking cucco", "stalfos", "dodongo"];
const resolve = (q: string) => fuzzyResolve(q, NAMES, (n) => n);

Deno.test("normalize lowercases and collapses punctuation", () => {
  assertEquals(normalize("Big Octo!"), "big octo");
  assertEquals(normalize("  A__B  "), "a b");
});

Deno.test("an exact name matches outright", () => {
  const r = resolve("cucco");
  assert(r.kind === "match" && r.entry === "cucco");
});

Deno.test("a unique prefix matches", () => {
  const r = resolve("stalf");
  assert(r.kind === "match" && r.entry === "stalfos");
});

Deno.test("an ambiguous prefix suggests, shortest first", () => {
  const r = resolve("cucco c"); // matches "cucco chick" only by prefix
  assert(r.kind === "match" && r.entry === "cucco chick");
  const many = resolve("c"); // cucco, cucco chick, (attacking) cucco…
  assert(many.kind === "suggest");
});

Deno.test("a typo suggests the nearest name", () => {
  const r = resolve("dodong");
  assert(r.kind === "match" && r.entry === "dodongo", "prefix");
  const typo = fuzzyResolve("stalfost", NAMES, (n) => n);
  assert(typo.kind === "suggest" && typo.entries.includes("stalfos"));
});

Deno.test("nonsense resolves to nothing", () => {
  assertEquals(resolve("zzzzzzzz").kind, "none");
  assertEquals(resolve("").kind, "none");
});

// ---- catalog ----

const DATA: CatalogData = {
  actors: [
    { key: "ACTOR_EN_NIW", name: "cucco", kind: "actor", soh: 25, s2h: 17 },
    { key: "ACTOR_BOSS_DODONGO", name: "dodongo", kind: "boss", soh: 18 },
    { key: "ACTOR_EN_TEST", name: "test", kind: "enemy", s2h: 5 },
  ],
  items: [
    { key: "ITEM_BOTTLE", name: "bottle", soh: true, s2h: true },
    { key: "ITEM_MASK_KEATON", name: "mask keaton", s2h: true },
  ],
};

Deno.test("catalog resolves an actor to its per-game ids", () => {
  const c = new Catalog(DATA);
  const r = c.resolveActor("cucco");
  assert(r.kind === "match");
  if (r.kind === "match") {
    assertEquals(c.actorGames(r.entry), ["soh", "2s2h"]);
    assertEquals(c.actorId(r.entry, "soh"), 25);
    assertEquals(c.actorId(r.entry, "2s2h"), 17);
  }
});

Deno.test("default prices scale by kind; bosses cost more", () => {
  const c = new Catalog(DATA);
  const cucco = c.resolveActor("cucco");
  const dodongo = c.resolveActor("dodongo");
  assert(cucco.kind === "match" && dodongo.kind === "match");
  if (cucco.kind === "match") assertEquals(c.actorPrice(cucco.entry), 50);
  if (dodongo.kind === "match") assertEquals(c.actorPrice(dodongo.entry), 300);
});

Deno.test("everything is enabled by default", () => {
  const c = new Catalog(DATA);
  const r = c.resolveActor("cucco");
  if (r.kind === "match") assertEquals(c.actorEnabled(r.entry), true);
});

Deno.test("an override disables an entry and sets a price", () => {
  const c = new Catalog(DATA);
  c.setOverride("actor", "ACTOR_EN_NIW", { enabled: false });
  c.setOverride("actor", "ACTOR_EN_NIW", { price: 500 });
  const r = c.resolveActor("cucco");
  if (r.kind === "match") {
    assertEquals(c.actorEnabled(r.entry), false);
    assertEquals(c.actorPrice(r.entry), 500);
  }
});

Deno.test("overrides round-trip through storage; enabled=true is pruned", () => {
  const c = new Catalog(DATA);
  c.setOverride("actor", "ACTOR_EN_NIW", { price: 99 });
  const saved = c.overrides();
  assertEquals(saved, { "actor:ACTOR_EN_NIW": { price: 99 } });

  // Re-enabling (the default) removes the flag; clearing price empties the entry.
  c.setOverride("actor", "ACTOR_EN_NIW", { enabled: true, price: undefined });
  assertEquals(c.overrides(), {}, "empty override is dropped");

  const c2 = new Catalog(DATA);
  c2.setOverrides(saved);
  const r = c2.resolveActor("cucco");
  if (r.kind === "match") assertEquals(c2.actorPrice(r.entry), 99);
});

Deno.test("items resolve, know their games, and are given by name", () => {
  const c = new Catalog(DATA);
  const r = c.resolveItem("bottle");
  assert(r.kind === "match");
  if (r.kind === "match") {
    assertEquals(c.itemGames(r.entry), ["soh", "2s2h"]);
    assertEquals(r.entry.name, "bottle");
  }
  const mask = c.resolveItem("mask keaton");
  if (mask.kind === "match") assertEquals(c.itemGames(mask.entry), ["2s2h"]);
});

Deno.test("rows() filters by name and reports enable/price/games", () => {
  const c = new Catalog(DATA);
  const rows = c.rows("actor", "cucco");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].name, "cucco");
  assertEquals(rows[0].games, ["soh", "2s2h"]);
  assertEquals(rows[0].enabled, true);

  const items = c.rows("item", "");
  assertEquals(items.length, 2);
});
