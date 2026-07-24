// tests/catalog_commands_test.ts — the !spawn / !give handlers (COM-50).
//
// !spawn / !give are chat-triggered, and there's no way to inject a real Twitch
// message locally, so the handlers are driven directly: real Catalog + Spawner +
// SpawnConfirmer, with a fake dispatch (whose OnActorInit we feed by hand), fake
// points (asserting exactly what was charged/refunded), and a fake chat that
// captures replies. Only Twitch chat itself is faked — everything the command
// decides is exercised.

import { assert, assertEquals } from "@std/assert";
import type {
  ChatApi,
  Ctx,
  Invocation,
  PointsApi,
  ProgrammaticCommand,
} from "@twitch-commander/plugin";
import type { OutgoingBody, ResultStatus, SailGame } from "../src/protocol.ts";
import type { SailDispatch } from "../src/dispatch.ts";
import { Catalog, type CatalogData } from "../src/catalog.ts";
import { SpawnConfirmer, Spawner } from "../src/spawn.ts";
import { registerCatalogCommands } from "../src/catalog_commands.ts";

const DATA: CatalogData = {
  actors: [
    { key: "ACTOR_EN_NIW", name: "cucco", kind: "actor", soh: 25, s2h: 17 },
    { key: "ACTOR_BOSS_GANON", name: "ganon", kind: "boss", soh: 20 },
  ],
  items: [{ key: "ITEM_BOTTLE", name: "bottle", soh: true, s2h: true }],
};

function fakeDispatch(connected: SailGame[]) {
  const sent: { game: SailGame; body: OutgoingBody }[] = [];
  let status: ResultStatus = "success";
  const dispatch: SailDispatch = {
    connected: (g) => connected.includes(g),
    send: (game, body) => {
      sent.push({ game, body });
      return Promise.resolve(status);
    },
  };
  return { dispatch, sent, setStatus: (s: ResultStatus) => (status = s) };
}

function fakePoints(opts: { enabled?: boolean; balance?: number } = {}) {
  const charges: { amount: number; refId?: string }[] = [];
  const refunds: number[] = [];
  let nextId = 100;
  const api = {
    enabled: () => opts.enabled ?? true,
    balance: () => opts.balance ?? 1000,
    add: () => ({ id: nextId++ }),
    tryCharge: (_u: string, amount: number, o?: { refId?: string }) => {
      if ((opts.balance ?? 1000) < amount) {
        return { ok: false, balance: opts.balance ?? 0 };
      }
      charges.push({ amount, refId: o?.refId });
      return { ok: true, txn: { id: nextId++ } };
    },
    refund: (id: number) => {
      refunds.push(id);
      return { id: nextId++ };
    },
  } as unknown as PointsApi;
  return { api, charges, refunds };
}

function fakeChat() {
  const sent: string[] = [];
  const api = {
    send: (text: string) => {
      sent.push(text);
      return Promise.resolve({});
    },
  } as unknown as ChatApi;
  return { api, sent };
}

function inv(...args: string[]): Invocation {
  return {
    user: {
      userId: "u1",
      login: "u",
      displayName: "U",
      isBroadcaster: false,
      isMod: false,
      isSubscriber: false,
    },
    args,
    raw: "",
    messageId: "m1",
  };
}

/** Wire the commands with fakes; return the two run handlers + the fakes. */
function harness(opts: {
  connected?: SailGame[];
  confirm?: boolean;
  points?: { enabled?: boolean; balance?: number };
  overrides?: (c: Catalog) => void;
} = {}) {
  const catalog = new Catalog(DATA);
  opts.overrides?.(catalog);
  const fd = fakeDispatch(opts.connected ?? ["soh", "2s2h"]);
  const confirmer = new SpawnConfirmer();
  const points = fakePoints(opts.points);
  const chat = fakeChat();

  const handlers = new Map<string, ProgrammaticCommand["run"]>();
  const ctx = {
    commands: {
      register(spec: ProgrammaticCommand) {
        handlers.set(spec.trigger, spec.run);
        return { dispose() {} };
      },
    },
  } as unknown as Ctx;

  registerCatalogCommands(ctx, {
    catalog,
    dispatch: fd.dispatch,
    spawner: new Spawner(fd.dispatch, confirmer),
    points: points.api,
    chat: chat.api,
    confirmEnabled: () => opts.confirm ?? false,
    windowMs: () => 500,
    log: { info() {} },
  });

  return {
    spawn: (...a: string[]) => handlers.get("spawn")!(inv(...a)),
    give: (...a: string[]) => handlers.get("give")!(inv(...a)),
    catalog,
    confirmer,
    ...fd,
    charges: points.charges,
    refunds: points.refunds,
    replies: chat.sent,
  };
}

const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) {
    await new Promise((r) => setTimeout(r, 2));
  }
};

// ---- AC: !spawn cucco works on both games ----

Deno.test("AC: !spawn cucco spawns on both games with per-game ids", async () => {
  const h = harness({ connected: ["soh", "2s2h"], confirm: true });
  const run = h.spawn("cucco");
  await waitFor(() => h.confirmer.pending === 2); // both waits registered
  h.confirmer.deliver("soh", { type: "OnActorInit", actorId: 25 });
  h.confirmer.deliver("2s2h", { type: "OnActorInit", actorId: 17 });
  await run;

  const spawns = h.sent.filter((s) => s.body.type === "command").map((s) => ({
    game: s.game,
    command: s.body.command,
  }));
  assertEquals(spawns, [
    { game: "soh", command: "spawn 25" },
    { game: "2s2h", command: "spawn 17" },
  ]);
  assertEquals(h.charges.length, 1, "charged once");
  assert(h.replies.some((r) => r.includes("spawned cucco")));
});

Deno.test("!spawn cucco with confirmation off just needs delivery", async () => {
  const h = harness({ connected: ["soh"], confirm: false });
  await h.spawn("cucco");
  assertEquals(h.sent.map((s) => s.body.command), ["spawn 25"]);
  assertEquals(h.charges[0].amount, 50, "default actor price");
});

// ---- AC: a disabled entry replies "not available" ----

Deno.test("AC: a disabled entry replies not available and doesn't charge", async () => {
  const h = harness({
    overrides: (c) =>
      c.setOverride("actor", "ACTOR_EN_NIW", { enabled: false }),
  });
  await h.spawn("cucco");
  assert(h.replies.some((r) => r.includes("isn't available")));
  assertEquals(h.charges.length, 0);
  assertEquals(h.sent.length, 0);
});

// ---- AC: a price override charges that price ----

Deno.test("AC: a price override charges exactly that price", async () => {
  const h = harness({
    confirm: false,
    overrides: (c) => c.setOverride("actor", "ACTOR_EN_NIW", { price: 777 }),
  });
  await h.spawn("cucco");
  assertEquals(h.charges, [{ amount: 777, refId: "ACTOR_EN_NIW" }]);
});

Deno.test("a boss uses its higher default price", async () => {
  const h = harness({ connected: ["soh"], confirm: false });
  await h.spawn("ganon");
  assertEquals(h.charges[0].amount, 300);
});

// ---- AC: unknown names suggest close matches ----

Deno.test("AC: an unknown name suggests close matches", async () => {
  const h = harness();
  await h.spawn("cuko"); // typo
  assert(
    h.replies.some((r) => r.includes("did you mean") && r.includes("cucco")),
  );
  assertEquals(h.charges.length, 0);
});

Deno.test("total nonsense says no match", async () => {
  const h = harness();
  await h.spawn("zzzzzz");
  assert(h.replies.some((r) => r.includes("no actor matches")));
});

// ---- charge / refund edges ----

Deno.test("insufficient points: reply, no spawn", async () => {
  const h = harness({ connected: ["soh"], points: { balance: 10 } });
  await h.spawn("cucco"); // costs 50
  assert(h.replies.some((r) => r.includes("you have 10")));
  assertEquals(h.sent.length, 0);
});

Deno.test("nothing lands → refund", async () => {
  const h = harness({ connected: ["soh"], confirm: false });
  h.setStatus("failure"); // the game refuses the spawn
  await h.spawn("cucco");
  assertEquals(h.charges.length, 1);
  assertEquals(h.refunds.length, 1, "the charge was refunded");
  assert(h.replies.some((r) => r.includes("Refunded")));
});

Deno.test("points off: spawn is free (no charge, no refund)", async () => {
  const h = harness({
    connected: ["soh"],
    confirm: false,
    points: { enabled: false },
  });
  await h.spawn("cucco");
  assertEquals(h.charges.length, 0);
  assertEquals(h.sent.map((s) => s.body.command), ["spawn 25"]);
});

Deno.test("a game that has the actor but is offline → connect hint", async () => {
  const h = harness({ connected: [] }); // nothing connected
  await h.spawn("cucco");
  assert(h.replies.some((r) => r.includes("isn't connected")));
  assertEquals(h.charges.length, 0);
});

// ---- !give ----

Deno.test("!give sends `give <name>` and charges the item price", async () => {
  const h = harness({ connected: ["soh", "2s2h"] });
  await h.give("bottle");
  const cmds = h.sent.map((s) => `${s.game}:${s.body.command}`);
  assertEquals(cmds, ["soh:give bottle", "2s2h:give bottle"]);
  assertEquals(h.charges[0].amount, 50);
  assert(h.replies.some((r) => r.includes("gave bottle")));
});

Deno.test("!give an unknown item suggests / reports no match", async () => {
  const h = harness();
  await h.give("botl");
  assert(
    h.replies.some((r) => r.includes("did you mean") && r.includes("bottle")),
  );
});
