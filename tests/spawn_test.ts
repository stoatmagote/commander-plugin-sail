// tests/spawn_test.ts — spawn with OnActorInit confirmation (COM-45).
//
// The confirmer's FIFO matching is tested directly; the sail.spawn function is
// driven against the real confirmer + a fake dispatch, feeding hooks by hand so
// confirm / timeout / refuse / 2S2H-subscribe all cover without a game.

import { assert, assertEquals } from "@std/assert";
import type { FunctionContext } from "@twitch-commander/plugin";
import type { OutgoingBody, ResultStatus, SailGame } from "../src/protocol.ts";
import type { SailDispatch } from "../src/dispatch.ts";
import {
  buildSpawnCommand,
  buildSpawnFunction,
  parseActorId,
  parseSpawnActorId,
  SpawnConfirmer,
  Spawner,
} from "../src/spawn.ts";
import { Catalog } from "../src/catalog.ts";

const actorInit = (actorId: number) => ({ type: "OnActorInit", actorId });

function fakeDispatch(
  connected: SailGame[] = ["soh", "2s2h"],
  status: (game: SailGame, body: OutgoingBody) => ResultStatus = () =>
    "success",
) {
  const sent: { game: SailGame; body: OutgoingBody }[] = [];
  const dispatch: SailDispatch = {
    connected: (game) => connected.includes(game),
    send: (game, body) => {
      sent.push({ game, body });
      return Promise.resolve(status(game, body));
    },
  };
  return { dispatch, sent };
}

function ctxOf(params: Record<string, string>): FunctionContext {
  return {
    params,
    invocation: {
      user: {
        userId: "1",
        login: "u",
        displayName: "U",
        isBroadcaster: false,
        isMod: false,
        isSubscriber: false,
      },
      args: [],
      raw: "",
      messageId: "m1",
    },
    prior: {},
    vars: {},
    signal: new AbortController().signal,
  };
}

function spawnFn(
  dispatch: SailDispatch,
  confirmer: SpawnConfirmer,
  opts: { confirm?: boolean; window?: number; catalog?: Catalog } = {},
) {
  return buildSpawnFunction({
    dispatch,
    spawner: new Spawner(dispatch, confirmer),
    catalog: opts.catalog,
    confirmEnabled: () => opts.confirm ?? true,
    windowMs: () => opts.window ?? 1000,
  });
}

/** A two-game actor whose id differs per game — the interesting case. */
const CATALOG = new Catalog({
  actors: [
    { key: "ACTOR_EN_NIW", name: "cucco", kind: "actor", soh: 25, s2h: 17 },
    { key: "ACTOR_SOH_ONLY", name: "soh only", kind: "actor", soh: 7 },
  ],
  items: [],
});

// ---- pure parsing ----

Deno.test("parseSpawnActorId matches the spawn verbs, decimal id", () => {
  assertEquals(parseSpawnActorId("spawn 24"), 24);
  assertEquals(parseSpawnActorId("  safespawn 3 1 2"), 3);
  assertEquals(parseSpawnActorId("spawnfwd 100"), 100);
  assertEquals(parseSpawnActorId("give 5"), null);
  assertEquals(parseSpawnActorId("spawn"), null);
});

Deno.test("parseActorId accepts decimal and 0x-hex", () => {
  assertEquals(parseActorId("24"), 24);
  assertEquals(parseActorId("0x18"), 24);
  assertEquals(parseActorId("0X18"), 24);
  assertEquals(parseActorId(" 7 "), 7);
  assertEquals(parseActorId("nope"), null);
  assertEquals(parseActorId(""), null);
  assertEquals(parseActorId("-1"), null);
});

Deno.test("buildSpawnCommand formats verb + decimal id + extras", () => {
  assertEquals(buildSpawnCommand("spawn", 24, ""), "spawn 24");
  assertEquals(buildSpawnCommand("safespawn", 3, "1 2 3"), "safespawn 3 1 2 3");
  assertEquals(buildSpawnCommand("bogus", 5, ""), "spawn 5", "verb falls back");
});

// ---- confirmer, with injected timers ----

/** A confirmer whose timeouts fire only when we say so. */
function manualConfirmer() {
  const timers = new Map<number, () => void>();
  let next = 1;
  const confirmer = new SpawnConfirmer({
    setTimer: (fn, _ms) => {
      const id = next++;
      timers.set(id, fn);
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
  });
  return {
    confirmer,
    fireAll: () => [...timers.values()].forEach((fn) => fn()),
  };
}

Deno.test("confirmer: a matching OnActorInit confirms the wait", async () => {
  const { confirmer } = manualConfirmer();
  const wait = confirmer.await("soh", 24, 1000);
  confirmer.deliver("soh", actorInit(24));
  assertEquals(await wait.confirmed, true);
  assertEquals(confirmer.pending, 0);
});

Deno.test("confirmer: a different actor id does not confirm", async () => {
  const m = manualConfirmer();
  const wait = m.confirmer.await("soh", 24, 1000);
  m.confirmer.deliver("soh", actorInit(99));
  assertEquals(m.confirmer.pending, 1, "still waiting");
  m.fireAll(); // timeout
  assertEquals(await wait.confirmed, false);
});

Deno.test("confirmer: a hook on the other game does not confirm", async () => {
  const m = manualConfirmer();
  const wait = m.confirmer.await("soh", 24, 1000);
  m.confirmer.deliver("2s2h", actorInit(24));
  assertEquals(m.confirmer.pending, 1);
  m.fireAll();
  assertEquals(await wait.confirmed, false);
});

Deno.test("AC: two same-actor spawns resolve FIFO, no cross-matching", async () => {
  const { confirmer } = manualConfirmer();
  const order: string[] = [];
  const first = confirmer.await("soh", 24, 1000);
  const second = confirmer.await("soh", 24, 1000);
  first.confirmed.then(() => order.push("first"));
  second.confirmed.then(() => order.push("second"));

  confirmer.deliver("soh", actorInit(24)); // → oldest (first)
  assertEquals(await first.confirmed, true);
  assertEquals(confirmer.pending, 1, "second still pending");

  confirmer.deliver("soh", actorInit(24)); // → second
  assertEquals(await second.confirmed, true);
  assertEquals(order, ["first", "second"], "resolved oldest-first");
});

Deno.test("confirmer: timeout resolves false and cleans up", async () => {
  const m = manualConfirmer();
  const wait = m.confirmer.await("soh", 24, 1000);
  m.fireAll();
  assertEquals(await wait.confirmed, false);
  assertEquals(m.confirmer.pending, 0);
});

Deno.test("confirmer: a late hook after timeout is harmless", async () => {
  const m = manualConfirmer();
  const wait = m.confirmer.await("soh", 24, 1000);
  m.fireAll();
  assertEquals(await wait.confirmed, false);
  m.confirmer.deliver("soh", actorInit(24)); // no waiter left — no throw
  assertEquals(m.confirmer.pending, 0);
});

Deno.test("confirmer: cancelAll fails everything in flight", async () => {
  const { confirmer } = manualConfirmer();
  const a = confirmer.await("soh", 1, 1000);
  const b = confirmer.await("2s2h", 2, 1000);
  confirmer.cancelAll();
  assertEquals(await a.confirmed, false);
  assertEquals(await b.confirmed, false);
  assertEquals(confirmer.pending, 0);
});

// ---- the function ----

Deno.test("AC: a confirmed spawn succeeds (charge stands)", async () => {
  const { dispatch, sent } = fakeDispatch(["soh"]);
  const confirmer = new SpawnConfirmer();
  const run = spawnFn(dispatch, confirmer).run(
    ctxOf({ target: "soh", actorId: "0x18" }),
  );
  // The wait is registered synchronously before the send; confirm it.
  await Promise.resolve();
  confirmer.deliver("soh", actorInit(24));

  const res = await run;
  assert(res.ok);
  if (res.ok) assertEquals(res.out?.actorId, 24);
  assertEquals(sent[0].body, { type: "command", command: "spawn 24" });
});

Deno.test("AC: an unconfirmed spawn fails so the engine refunds", async () => {
  const { dispatch } = fakeDispatch(["soh"]);
  const confirmer = new SpawnConfirmer();
  // Short real window, no hook delivered → times out false.
  const res = await spawnFn(dispatch, confirmer, { window: 30 }).run(
    ctxOf({ target: "soh", actorId: "24" }),
  );
  assertEquals(res.ok, false);
});

Deno.test("a spawn command the game refuses fails immediately", async () => {
  const started = Date.now();
  const { dispatch } = fakeDispatch(["soh"], () => "failure");
  const confirmer = new SpawnConfirmer();
  const res = await spawnFn(dispatch, confirmer, { window: 5000 }).run(
    ctxOf({ target: "soh", actorId: "24" }),
  );
  assertEquals(res.ok, false);
  assert(Date.now() - started < 1000, "didn't wait out the window");
});

Deno.test("confirmation off: succeeds on acceptance, no OnActorInit needed", async () => {
  const { dispatch, sent } = fakeDispatch(["soh"]);
  const confirmer = new SpawnConfirmer();
  const res = await spawnFn(dispatch, confirmer, { confirm: false }).run(
    ctxOf({ target: "soh", actorId: "24" }),
  );
  assert(res.ok, "no confirmation wait");
  assertEquals(sent.length, 1);
  assertEquals(confirmer.pending, 0);
});

Deno.test("a disconnected target fails without sending", async () => {
  const { dispatch, sent } = fakeDispatch([]); // nothing connected
  const res = await spawnFn(dispatch, new SpawnConfirmer()).run(
    ctxOf({ target: "soh", actorId: "24" }),
  );
  assertEquals(res.ok, false);
  assertEquals(sent.length, 0);
});

Deno.test("2S2H spawn subscribes to OnActorInit (filtered) and unsubscribes", async () => {
  const { dispatch, sent } = fakeDispatch(["2s2h"]);
  const confirmer = new SpawnConfirmer();
  const run = spawnFn(dispatch, confirmer).run(
    ctxOf({ target: "2s2h", actorId: "42" }),
  );
  // Let the subscribe + spawn send flush, then confirm.
  await Promise.resolve();
  await Promise.resolve();
  confirmer.deliver("2s2h", actorInit(42));
  const res = await run;
  assert(res.ok);

  const types = sent.map((s) =>
    `${s.body.type}:${s.body.eventName ?? s.body.command}`
  );
  assertEquals(types[0], "subscribe:OnActorInit", "subscribed first");
  assertEquals(sent[0].body.eventIdFilter, 42, "filtered to the actor");
  assert(types.includes("command:spawn 42"), "then spawned");
  assertEquals(
    types[types.length - 1],
    "unsubscribe:OnActorInit",
    "cleaned up",
  );
});

// ---- catalog keys (COM-59) ----

Deno.test("a catalog key spawns the right id in each game", async () => {
  const { dispatch, sent } = fakeDispatch(["soh", "2s2h"]);
  const confirmer = new SpawnConfirmer();
  const fn = spawnFn(dispatch, confirmer, { confirm: false, catalog: CATALOG });

  const result = await fn.run(
    ctxOf({ target: "both", actorId: "ACTOR_EN_NIW" }),
  );
  assert(result.ok);
  assertEquals(result.out?.name, "cucco");
  // The same actor, numbered differently: 25 in SoH, 17 in 2S2H.
  const commands = sent.map((s) =>
    (s.body as { command?: string }).command ?? ""
  );
  assert(commands.some((c) => c.includes("25")), `SoH got: ${commands}`);
  assert(commands.some((c) => c.includes("17")), `2S2H got: ${commands}`);
});

Deno.test("an actor missing from a connected game is skipped, not failed", async () => {
  const { dispatch, sent } = fakeDispatch(["soh", "2s2h"]);
  const fn = spawnFn(dispatch, new SpawnConfirmer(), {
    confirm: false,
    catalog: CATALOG,
  });

  // "soh only" exists in one game; targeting both should still work there.
  const result = await fn.run(
    ctxOf({ target: "both", actorId: "ACTOR_SOH_ONLY" }),
  );
  assert(result.ok);
  assertEquals(result.out?.games, "soh");
  assertEquals(sent.length, 1);
});

Deno.test("a raw id still works, and an unknown name still fails", async () => {
  const { dispatch } = fakeDispatch(["soh"]);
  const fn = spawnFn(dispatch, new SpawnConfirmer(), {
    confirm: false,
    catalog: CATALOG,
  });

  assert((await fn.run(ctxOf({ target: "soh", actorId: "0x18" }))).ok);
  const bad = await fn.run(ctxOf({ target: "soh", actorId: "nonsense" }));
  assert(!bad.ok);
  assert(!bad.ok && bad.error.includes("not an actor id"));
});
