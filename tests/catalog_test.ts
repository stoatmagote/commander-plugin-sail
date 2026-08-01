// tests/catalog_test.ts — fuzzy matching and the catalog (COM-50).

import { assert, assertEquals } from "@std/assert";
import { fuzzyResolve, normalize } from "../src/fuzzy.ts";
import { Catalog, type CatalogData } from "../src/catalog.ts";
import { BUNDLED_CATALOG } from "../src/catalog.data.ts";

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

Deno.test("spawn distance: game default, catalog value, then override", () => {
  const c = new Catalog({
    actors: [
      { key: "A_PLAIN", name: "plain", kind: "actor", soh: 1 },
      { key: "A_BIG", name: "big", kind: "boss", soh: 2, distance: 400 },
    ],
    items: [],
  });
  const plain = c.actorByKey("A_PLAIN")!;
  const big = c.actorByKey("A_BIG")!;

  // Untuned actors keep safespawn's own default, so nothing changes for them.
  assertEquals(c.actorDistance(plain), 120);
  assertEquals(c.actorDistance(big), 400, "the catalog's own value wins");

  c.setOverride("actor", "A_BIG", { distance: 600 });
  assertEquals(c.actorDistance(big), 600, "the streamer's override wins");

  c.setOverride("actor", "A_BIG", { distance: undefined });
  assertEquals(c.actorDistance(big), 400, "clearing falls back, not to 120");
});

Deno.test("every actor option carries a distance, tuned or not", () => {
  const c = new Catalog(DATA);
  // The !spawn step templates {arg.actor.meta.distance}, which fails the step
  // when the chosen option lacks the key — so it can't be present only on the
  // handful of actors someone has tuned.
  const options = c.actorOptions();
  assert(options.length > 0);
  for (const o of options) {
    assertEquals(
      typeof o.meta?.distance,
      "string",
      `${o.value} has no distance`,
    );
  }

  c.setOverride("actor", "ACTOR_EN_NIW", { distance: 300 });
  const cucco = c.actorOptions().find((o) => o.value === "ACTOR_EN_NIW");
  assertEquals(cucco?.meta?.distance, "300");
});

// ---- aliases (COM-64) ----

Deno.test("aliases come from the catalog and can be overridden", () => {
  const c = new Catalog({
    actors: [
      { key: "A_NIW", name: "cucco", kind: "actor", soh: 25, aliases: ["hen"] },
    ],
    items: [],
  });
  const niw = c.actorByKey("A_NIW")!;
  assertEquals(c.actorAliases(niw), ["hen"]);

  // The override replaces rather than extends, so a bundled alias can be
  // removed as well as added to.
  assertEquals(c.setActorAliases("A_NIW", ["chicken", "bird"]), { ok: true });
  assertEquals(c.actorAliases(niw), ["chicken", "bird"]);

  assertEquals(c.setActorAliases("A_NIW", []), { ok: true });
  assertEquals(c.actorAliases(niw), [], "cleared, not fallen back to catalog");
});

Deno.test("an alias naming another entry is refused, not silently shadowing", () => {
  const c = new Catalog(DATA);
  const clash = c.setActorAliases("ACTOR_EN_NIW", ["dodongo"]);
  assert(!clash.ok);
  if (!clash.ok) assert(clash.error.includes("dodongo"));
  assertEquals(c.actorAliases(c.actorByKey("ACTOR_EN_NIW")!), [], "not saved");

  // Compared normalized, so case and surrounding space can't sneak a
  // duplicate past the check.
  assert(!c.setActorAliases("ACTOR_EN_NIW", [" DoDonGo "]).ok);

  // An entry's own name is redundant rather than an error.
  assertEquals(c.setActorAliases("ACTOR_EN_NIW", ["Cucco", "hen"]), {
    ok: true,
  });
  assertEquals(c.actorAliases(c.actorByKey("ACTOR_EN_NIW")!), ["hen"]);
});

Deno.test("options publish aliases, and the grid finds an entry by one", () => {
  const c = new Catalog(DATA);
  c.setActorAliases("ACTOR_EN_NIW", ["chicken"]);

  const cucco = c.actorOptions().find((o) => o.value === "ACTOR_EN_NIW");
  assertEquals(cucco?.aliases, ["chicken"]);
  assertEquals(cucco?.label, "cucco", "the label stays canonical for chat");

  // Searching the alias has to find it, or you can't look up what you added.
  const found = c.rows("actor", { filter: "chicken" });
  assertEquals(found.rows.map((r) => r.name), ["cucco"]);
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
  const { rows, total } = c.rows("actor", { filter: "cucco" });
  assertEquals(rows.length, 1);
  assertEquals(total, 1, "total counts matches, not the whole catalog");
  assertEquals(rows[0].name, "cucco");
  assertEquals(rows[0].games, ["soh", "2s2h"]);
  assertEquals(rows[0].enabled, true);

  assertEquals(c.rows("item", {}).rows.length, 2);
});

// ---- per-actor extras (COM-67) ----

Deno.test("extras ride alongside distance, and distance stays authoritative", () => {
  const c = new Catalog({
    actors: [
      {
        key: "A_NIW",
        name: "cucco",
        kind: "actor",
        soh: 25,
        meta: { sound: "cluck" },
      },
    ],
    items: [],
  });
  const niw = c.actorByKey("A_NIW")!;
  assertEquals(c.actorMeta(niw), { sound: "cluck" });

  // Published together, so a step can template either.
  const option = c.actorOptions()[0];
  assertEquals(option.meta, { sound: "cluck", distance: "120" });

  assertEquals(c.setActorMeta("A_NIW", { angry: "1" }), { ok: true });
  assertEquals(c.actorOptions()[0].meta, { angry: "1", distance: "120" });

  // The typed distance still wins, and the column still drives it.
  c.setOverride("actor", "A_NIW", { distance: 400 });
  assertEquals(c.actorOptions()[0].meta?.distance, "400");
});

Deno.test("extras are refused when the template couldn't address them", () => {
  const c = new Catalog(DATA);
  const key = "ACTOR_EN_NIW";

  const dotted = c.setActorMeta(key, { "a.b": "x" });
  assert(!dotted.ok);
  if (!dotted.ok) assert(dotted.error.includes("letters, digits"));

  // distance has its own column; an extra by that name would fight it.
  const reserved = c.setActorMeta(key, { distance: "400" });
  assert(!reserved.ok);
  if (!reserved.ok) assert(reserved.error.includes("own column"));

  // Silently dropping this would look like the edit saved and vanished.
  const blank = c.setActorMeta(key, { sound: "  " });
  assert(!blank.ok);
  if (!blank.ok) assert(blank.error.includes("needs a value"));

  assertEquals(c.actorMeta(c.actorByKey(key)!), {}, "nothing was saved");
});

Deno.test("clearing extras removes a bundled one rather than restoring it", () => {
  const c = new Catalog({
    actors: [
      { key: "A", name: "a", kind: "actor", soh: 1, meta: { sound: "cluck" } },
      { key: "B", name: "b", kind: "actor", soh: 2 },
    ],
    items: [],
  });

  assertEquals(c.setActorMeta("A", {}), { ok: true });
  assertEquals(c.actorMeta(c.actorByKey("A")!), {}, "bundled one is gone");

  // An entry that never had extras stores nothing rather than an empty map.
  assertEquals(c.setActorMeta("B", {}), { ok: true });
  assertEquals(c.overrides()["actor:B"], undefined);
});

// ---- grid filters and sorting (COM-65) ----

Deno.test("rows() filters by state, game and actor kind, and combines them", () => {
  const c = new Catalog(DATA);
  const names = (q: Parameters<typeof c.rows>[1]) =>
    c.rows("actor", q).rows.map((r) => r.name);

  c.setOverride("actor", "ACTOR_EN_TEST", { enabled: false });
  assertEquals(names({ state: "disabled" }), ["test"]);
  assertEquals(names({ state: "enabled" }), ["cucco", "dodongo"]);

  // "both" means present in both games, not "either".
  assertEquals(names({ game: "both" }), ["cucco"]);
  assertEquals(names({ game: "soh" }), ["cucco", "dodongo"]);
  assertEquals(names({ game: "2s2h" }), ["cucco", "test"]);

  assertEquals(names({ actorKind: "boss" }), ["dodongo"]);
  assertEquals(names({ actorKind: "enemy" }), ["test"]);
  assertEquals(names({ actorKind: "actor" }), ["cucco"], "non-enemies");

  // Combined: a disabled enemy that exists in 2S2H.
  assertEquals(
    names({ state: "disabled", game: "2s2h", actorKind: "enemy" }),
    ["test"],
  );
  assertEquals(names({ state: "enabled", actorKind: "enemy" }), []);
});

// ---- pagination (COM-66) ----

Deno.test("rows() pages through the matching set", () => {
  // 450 actors, so the third page is a partial one.
  const many: CatalogData = {
    actors: Array.from({ length: 450 }, (_, i) => ({
      key: `A_${String(i).padStart(3, "0")}`,
      name: `actor ${String(i).padStart(3, "0")}`,
      kind: "actor" as const,
      soh: i,
    })),
    items: [],
  };
  const c = new Catalog(many);
  const q = { sort: "name" as const };

  const first = c.rows("actor", q);
  assertEquals(first.page, 1);
  assertEquals(first.pages, 3);
  assertEquals(first.total, 450);
  assertEquals(first.rows.length, 200);
  assertEquals(first.rows[0].name, "actor 000");

  // The whole point: entries 201-400 are reachable.
  const second = c.rows("actor", { ...q, page: 2 });
  assertEquals(second.rows[0].name, "actor 200");
  assertEquals(second.rows[199].name, "actor 399");

  const third = c.rows("actor", { ...q, page: 3 });
  assertEquals(third.rows.length, 50, "last page is partial");
  assertEquals(third.rows[49].name, "actor 449");
});

Deno.test("a page past the end clamps instead of showing nothing", () => {
  const c = new Catalog(DATA);
  // A filter can shrink the set under whatever page you were on; an empty grid
  // with no way back would look like everything vanished.
  const past = c.rows("actor", { page: 99 });
  assertEquals(past.page, 1);
  assertEquals(past.pages, 1);
  assertEquals(past.rows.length, 3);

  // No matches is still a valid, navigable page 1 of 1.
  const none = c.rows("actor", { filter: "zzzzzz" });
  assertEquals(none.total, 0);
  assertEquals(none.page, 1);
  assertEquals(none.pages, 1);
  assertEquals(none.rows, []);
});

Deno.test("rows() sorts the whole matching set, not just the visible page", () => {
  const c = new Catalog(DATA);
  const names = (q: Parameters<typeof c.rows>[1]) =>
    c.rows("actor", q).rows.map((r) => r.name);

  assertEquals(names({ sort: "name" }), ["cucco", "dodongo", "test"]);
  assertEquals(names({ sort: "name", desc: true }), [
    "test",
    "dodongo",
    "cucco",
  ]);
  // Default prices: actor 50, enemy 100, boss 300.
  assertEquals(names({ sort: "price" }), ["cucco", "test", "dodongo"]);
  assertEquals(names({ sort: "price", desc: true }), [
    "dodongo",
    "test",
    "cucco",
  ]);
  // Single-game entries group before the two-game one.
  assertEquals(names({ sort: "games" })[2], "cucco");

  // Sorting happens before the cap, so the top of the order is the real top
  // rather than whatever the first page happened to hold.
  const capped = c.rows("actor", { sort: "price", desc: true, limit: 1 });
  assertEquals(capped.rows.map((r) => r.name), ["dodongo"]);
  assertEquals(capped.total, 3, "total still counts everything that matched");
});

// ---- option lists (COM-59) ----

Deno.test("the catalog publishes enabled entries as priced options", () => {
  const c = new Catalog(DATA);
  const actors = c.actorOptions();

  // The value is the catalog key, not an id: the same actor is numbered
  // differently per game, so sail.spawn resolves it when it runs.
  assertEquals(actors.map((o) => o.value), [
    "ACTOR_EN_NIW",
    "ACTOR_BOSS_DODONGO",
    "ACTOR_EN_TEST",
  ]);
  assertEquals(actors[0].label, "cucco");
  assertEquals(actors[0].cost, 50, "an ordinary actor's default price");
  assertEquals(actors[1].cost, 300, "a boss costs more");
  assertEquals(actors[2].cost, 100, "an enemy costs more than an actor");

  // Items are given by name, so that's what the steps receive.
  assertEquals(c.itemOptions().map((o) => o.value), ["bottle", "mask keaton"]);
  assertEquals(c.itemOptions()[0].cost, 50);
});

Deno.test("the grid's overrides drive the options", () => {
  const c = new Catalog(DATA);
  c.setOverride("actor", "ACTOR_BOSS_DODONGO", { price: 1234 });
  c.setOverride("actor", "ACTOR_EN_TEST", { enabled: false });
  c.setOverride("item", "ITEM_BOTTLE", { enabled: false });

  const actors = c.actorOptions();
  assertEquals(actors.length, 2, "a disabled entry isn't offered at all");
  assertEquals(
    actors.find((o) => o.value === "ACTOR_BOSS_DODONGO")?.cost,
    1234,
  );
  assertEquals(c.itemOptions().map((o) => o.value), ["mask keaton"]);
});

Deno.test("an actor can be found by the key an option hands over", () => {
  const c = new Catalog(DATA);
  assertEquals(c.actorByKey("ACTOR_EN_NIW")?.name, "cucco");
  assertEquals(c.actorByKey("actor_en_niw")?.name, "cucco", "case-insensitive");
  assertEquals(c.actorByKey("nope"), undefined);
});

Deno.test("a child-only actor is never offered to chat", () => {
  // COM-72: the Snapper is Gekko's mount and crashed 2S2H when spawned alone.
  // The games are patched to fail safe now, but a lone one still does nothing,
  // so it must not reach !spawn — a viewer would pay for an actor that removes
  // itself. Deliberately NOT a per-entry toggle: spawning it is never right.
  const c = new Catalog({
    actors: [
      { key: "A_NORMAL", name: "normal", kind: "enemy", soh: 1 },
      {
        key: "A_CHILD",
        name: "child only",
        kind: "boss",
        soh: 2,
        requiresParent: true,
      },
    ],
    items: [],
  });

  assertEquals(c.actorOptions().map((o) => o.value), ["A_NORMAL"]);
  // Still resolvable and still in the grid — the streamer can see why it's
  // absent rather than the entry silently vanishing from the catalog.
  assertEquals(c.actorByKey("A_CHILD")?.name, "child only");
});

Deno.test("the real catalog keeps the known child-only actors out", () => {
  const c = new Catalog(BUNDLED_CATALOG);
  const offered = new Set(c.actorOptions().map((o) => o.value));
  for (
    const key of [
      "ACTOR_EN_BIGPAMET", // snapper — crashed 2S2H live
      "ACTOR_EN_MINIDEATH",
      "ACTOR_EN_MINISLIME",
      "ACTOR_EN_HAKUROCK",
      "ACTOR_EN_PART",
    ]
  ) {
    assertEquals(offered.has(key), false, `${key} must not be offered`);
  }
  // Their spawnable parents must still be there, or the fix removed the fun.
  for (const name of ["gekko", "fused jellies gekko"]) {
    const r = c.resolveActor(name);
    assertEquals(r.kind, "match", `${name} should still be spawnable`);
  }
});
