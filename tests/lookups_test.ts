// tests/lookups_test.ts — lookup parsers and the runtime store (COM-41).

import { assert, assertEquals } from "@std/assert";
import {
  extractEnumBody,
  extractEnumBodyContaining,
  parseActorTable,
  parseEnum,
  parseSceneTable,
} from "../scripts/parsers.ts";
import {
  annotateHook,
  hexFallback,
  type LookupData,
  LookupStore,
} from "../src/lookups.ts";

// ---- parsers (against snippets in the real header formats) ----

Deno.test("parseActorTable: 2S2H uses the trailing quoted description", () => {
  const src = `
/* 0x000 */ DEFINE_ACTOR_INTERNAL(Player, ACTOR_PLAYER, ALLOCTYPE_NORMAL, "Player", "Player")
/* 0x001 */ DEFINE_ACTOR(En_Test, ACTOR_EN_TEST, ALLOCTYPE_NORMAL, "En_Test", "Crater Marks")
/* 0x002 */ DEFINE_ACTOR_UNSET(0x0002)
/* 0x003 */ DEFINE_ACTOR(En_GirlA, ACTOR_EN_GIRLA, ALLOCTYPE_NORMAL, "En_GirlA", "Girl A")
`;
  const map = parseActorTable(src);
  assertEquals(map[0], "Player");
  assertEquals(map[1], "Crater Marks", "last quoted arg wins");
  assertEquals(map[2], undefined, "UNSET is skipped");
  assertEquals(map[3], "Girl A");
});

Deno.test("parseActorTable: SoH (no quotes) falls back to the ACTOR_ enum", () => {
  const src = `
/* 0x0000 */ DEFINE_ACTOR_INTERNAL(Player, ACTOR_PLAYER, ALLOCTYPE_NORMAL)
/* 0x0002 */ DEFINE_ACTOR(En_Test, ACTOR_EN_TEST, ALLOCTYPE_NORMAL)
`;
  const map = parseActorTable(src);
  assertEquals(map[0], "ACTOR_PLAYER");
  assertEquals(map[2], "ACTOR_EN_TEST", "the /* 0x0002 */ hint sets the id");
});

Deno.test("parseActorTable: nested parens in args don't break the scan", () => {
  const src =
    `/* 0x005 */ DEFINE_ACTOR(En_X, ACTOR_EN_X, ALLOCTYPE_ABSOLUTE(2), "En_X", "Nested")`;
  assertEquals(parseActorTable(src)[5], "Nested");
});

Deno.test("parseSceneTable: quoted display name, and UNSET skipped", () => {
  const src = `
/* 0x00 */ DEFINE_SCENE(ydan, g, SCENE_DEKU_TREE, SDC, 1, 2, "Deku Tree")
/* 0x01 */ DEFINE_SCENE_UNSET(SCENE_UNSET_01)
/* 0x02 */ DEFINE_SCENE(ddan, g, SCENE_DODONGO, SDC, 1, 3)
`;
  const map = parseSceneTable(src);
  assertEquals(map[0], "Deku Tree");
  assertEquals(map[1], undefined);
  assertEquals(map[2], "SCENE_DODONGO", "no quotes → SCENE_ enum name");
});

Deno.test("parseEnum: explicit values, hex hints, and running counter", () => {
  const body = `
    ITEM_A,            // 0
    ITEM_B = 5,
    /* 0x10 */ ITEM_C,
    ITEM_D,
  `;
  const map = parseEnum(body);
  assertEquals(map[0], "ITEM_A");
  assertEquals(map[5], "ITEM_B");
  assertEquals(map[16], "ITEM_C", "0x10 hint");
  assertEquals(map[17], "ITEM_D", "continues from the hint");
});

Deno.test("extractEnumBody / …Containing find the right enum", () => {
  const src = `
    typedef enum FlagType { FLAG_NONE, FLAG_A } FlagType;
    typedef enum { ITEM_X, ITEM_BOTTLE, ITEM_Y } ;
  `;
  assert(extractEnumBody(src, "FlagType")?.includes("FLAG_A"));
  assertEquals(extractEnumBody(src, "Nope"), null);
  assert(extractEnumBodyContaining(src, "ITEM_BOTTLE")?.includes("ITEM_Y"));
});

// ---- runtime store ----

const DATA: LookupData = {
  soh: { actors: { "2": "ACTOR_EN_TEST" }, items: { "20": "ITEM_BOTTLE" } },
  "2s2h": { actors: { "100": "Shellblade" }, scenes: { "0": "Swamp" } },
};

Deno.test("store resolves names and falls back to hex", () => {
  const s = new LookupStore(DATA);
  assertEquals(s.name("2s2h", "actors", 100), "Shellblade");
  assertEquals(s.name("soh", "items", 20), "ITEM_BOTTLE");
  assertEquals(s.name("soh", "actors", 9999), "ACTOR 0x270f", "hex fallback");
  assertEquals(hexFallback("scenes", 5), "SCENE 0x0005");
});

Deno.test("store is isolated from the source data (defensive copy)", () => {
  const base: LookupData = { soh: { actors: { "1": "A" } } };
  const s = new LookupStore(base);
  s.set("soh", "actors", { "1": "B" });
  assertEquals(base.soh.actors["1"], "A", "the caller's object is untouched");
  assertEquals(s.name("soh", "actors", 1), "B");
});

Deno.test("applyCache overlays a snapshot but keeps uncovered tables", () => {
  const s = new LookupStore(DATA);
  s.applyCache({
    "2s2h": { actors: { "100": "Shellblade v2", "101": "New" } },
  });
  assertEquals(s.name("2s2h", "actors", 100), "Shellblade v2", "overlaid");
  assertEquals(s.name("2s2h", "actors", 101), "New");
  assertEquals(s.name("soh", "items", 20), "ITEM_BOTTLE", "kept from bundled");
});

Deno.test("applyCache ignores garbage", () => {
  const s = new LookupStore(DATA);
  s.applyCache(undefined);
  s.applyCache("nonsense");
  s.applyCache({ soh: { actors: {} } }); // empty map → ignored
  assertEquals(s.name("soh", "actors", 2), "ACTOR_EN_TEST");
});

Deno.test("refresh updates tables from a base URL", async () => {
  const s = new LookupStore({ soh: { actors: { "1": "old" } } });
  const fetcher = (url: string) => {
    if (url === "https://x/actors_soh.json") {
      return Promise.resolve(
        new Response(JSON.stringify({ "1": "new", "2": "another" })),
      );
    }
    return Promise.resolve(new Response("nope", { status: 404 }));
  };
  const results = await s.refresh(fetcher, "https://x/");
  assertEquals(results, [{
    game: "soh",
    category: "actors",
    ok: true,
    count: 2,
  }]);
  assertEquals(s.name("soh", "actors", 1), "new");
  assertEquals(s.name("soh", "actors", 2), "another");
});

Deno.test("a failed refresh keeps existing data", async () => {
  const s = new LookupStore({ soh: { actors: { "1": "keep" } } });
  const results = await s.refresh(
    () => Promise.resolve(new Response("down", { status: 500 })),
    "https://x",
  );
  assertEquals(results[0].ok, false);
  assert(results[0].error?.includes("500"));
  assertEquals(s.name("soh", "actors", 1), "keep", "data survived the failure");
});

Deno.test("an empty refresh payload is treated as a failure", async () => {
  const s = new LookupStore({ soh: { actors: { "1": "keep" } } });
  const results = await s.refresh(
    () => Promise.resolve(new Response("{}")),
    "https://x",
  );
  assertEquals(results[0].ok, false);
  assertEquals(s.name("soh", "actors", 1), "keep");
});

// ---- hook annotation (the "names, not ids" AC) ----

Deno.test("annotateHook resolves known id fields to names", () => {
  const s = new LookupStore(DATA);
  assertEquals(
    annotateHook("2s2h", { type: "OnActorInit", actorId: 100, params: 0 }, s),
    "OnActorInit actorId=100 (Shellblade) params=0",
  );
  assertEquals(
    annotateHook("2s2h", { type: "OnSceneInit", sceneNum: 0 }, s),
    "OnSceneInit sceneNum=0 (Swamp)",
  );
  assertEquals(
    annotateHook("soh", { type: "OnActorInit", actorId: 2, params: 0 }, s),
    "OnActorInit actorId=2 (ACTOR_EN_TEST) params=0",
  );
});

Deno.test("annotateHook hex-falls-back an unknown id and passes plain fields", () => {
  const s = new LookupStore(DATA);
  assertEquals(
    annotateHook("soh", { type: "OnActorInit", actorId: 4095, params: 7 }, s),
    "OnActorInit actorId=4095 (ACTOR 0x0fff) params=7",
  );
  assertEquals(annotateHook("soh", { type: "OnLoadGame" }, s), "OnLoadGame");
});
