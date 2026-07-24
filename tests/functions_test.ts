// tests/functions_test.ts — Sail game-control functions (COM-40).
//
// Targeting is pure, and the sending sits behind SailDispatch, so every
// function is driven against a fake dispatch that records the exact packets —
// no sockets, no games.

import { assert, assertEquals } from "@std/assert";
import type { FunctionContext, FunctionSpec } from "@twitch-commander/plugin";
import {
  describeOffline,
  liveGames,
  type SailDispatch,
} from "../src/dispatch.ts";
import { buildSailFunctions, parseParameters } from "../src/functions.ts";
import type { OutgoingBody, ResultStatus, SailGame } from "../src/protocol.ts";

function fakeDispatch(
  connected: SailGame[] = ["soh", "2s2h"],
  status: (game: SailGame) => ResultStatus = () => "success",
) {
  const sent: { game: SailGame; body: OutgoingBody }[] = [];
  const dispatch: SailDispatch = {
    connected: (game) => connected.includes(game),
    send: (game, body) => {
      sent.push({ game, body });
      return Promise.resolve(status(game));
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
    signal: new AbortController().signal,
  };
}

function fns(dispatch: SailDispatch): Map<string, FunctionSpec> {
  return new Map(buildSailFunctions({ dispatch }).map((f) => [f.id, f]));
}

const all: SailGame[] = ["soh", "2s2h"];
const has = (games: SailGame[]) => (g: SailGame) => games.includes(g);

// ---- pure targeting ----

Deno.test("liveGames resolves each target against what's connected", () => {
  assertEquals(liveGames("soh", has(all)), ["soh"]);
  assertEquals(liveGames("2s2h", has(all)), ["2s2h"]);
  assertEquals(liveGames("both", has(all)), ["soh", "2s2h"]);
  assertEquals(liveGames("any", has(all)), ["soh"], "any prefers SoH");

  assertEquals(liveGames("soh", has(["2s2h"])), [], "target down → nothing");
  assertEquals(liveGames("both", has(["2s2h"])), ["2s2h"], "both = all live");
  assertEquals(liveGames("any", has(["2s2h"])), ["2s2h"], "any falls through");
  assertEquals(liveGames("any", has([])), []);
  assertEquals(liveGames("both", has([])), []);
});

Deno.test("describeOffline names the specific game", () => {
  assert(describeOffline("soh").includes("Ship of Harkinian"));
  assert(describeOffline("2s2h").includes("2 Ship 2 Harkinian"));
  assertEquals(describeOffline("both"), "no game is connected");
  assertEquals(describeOffline("any"), "no game is connected");
});

Deno.test("parseParameters keeps numbers numeric", () => {
  assertEquals(parseParameters("3, 5"), [3, 5]);
  assertEquals(parseParameters("1.5,left"), [1.5, "left"]);
  assertEquals(parseParameters(""), []);
  assertEquals(parseParameters(undefined), []);
  assertEquals(parseParameters(" , ,"), []);
});

// ---- functions ----

Deno.test("every Sail function needs no Twitch account", () => {
  for (const f of buildSailFunctions({ dispatch: fakeDispatch().dispatch })) {
    assertEquals(f.requires.account, "none", f.id);
  }
});

Deno.test("command sends a console packet to the targeted game", async () => {
  const { dispatch, sent } = fakeDispatch();
  const res = await fns(dispatch).get("command")!.run(
    ctxOf({ target: "soh", command: "spawn 0x0018" }),
  );
  assert(res.ok);
  assertEquals(sent, [{
    game: "soh",
    body: { type: "command", command: "spawn 0x0018" },
  }]);
});

Deno.test("command with target=both reaches both connected games", async () => {
  const { dispatch, sent } = fakeDispatch();
  const res = await fns(dispatch).get("command")!.run(
    ctxOf({ target: "both", command: "heal" }),
  );
  assert(res.ok);
  if (res.ok) assertEquals(res.out?.games, "soh,2s2h");
  assertEquals(sent.map((s) => s.game), ["soh", "2s2h"]);
});

Deno.test("AC: a disconnected target fails so the engine refunds", async () => {
  const { dispatch, sent } = fakeDispatch([]); // nothing connected
  const res = await fns(dispatch).get("command")!.run(
    ctxOf({ target: "soh", command: "spawn 1" }),
  );
  assertEquals(res.ok, false);
  if (!res.ok) assert(res.error?.includes("Ship of Harkinian"));
  assertEquals(sent.length, 0, "nothing was sent");
});

Deno.test("a game that rejects the packet fails the step", async () => {
  const { dispatch } = fakeDispatch(all, () => "failure");
  const res = await fns(dispatch).get("command")!.run(
    ctxOf({ target: "soh", command: "bogus" }),
  );
  assertEquals(res.ok, false);
});

Deno.test("AC: effect apply/remove sends the right packet on SoH", async () => {
  const { dispatch, sent } = fakeDispatch();
  const f = fns(dispatch).get("effect")!;

  await f.run(
    ctxOf({
      target: "soh",
      name: "ModifyLinkSize",
      action: "apply",
      parameters: "2",
    }),
  );
  await f.run(
    ctxOf({ target: "soh", name: "ModifyLinkSize", action: "remove" }),
  );

  assertEquals(sent[0].body, {
    type: "effect",
    effect: { type: "apply", name: "ModifyLinkSize", parameters: [2] },
  });
  assertEquals(sent[1].body, {
    type: "effect",
    effect: { type: "remove", name: "ModifyLinkSize" },
  }, "remove carries no parameters");
});

Deno.test("AC: an effect on 2S2H reports unsupported (it stubs effects)", async () => {
  const { dispatch, sent } = fakeDispatch();
  const res = await fns(dispatch).get("effect")!.run(
    ctxOf({ target: "2s2h", name: "FreezePlayer", action: "apply" }),
  );
  assertEquals(res.ok, false);
  if (!res.ok) assert(res.error?.includes("override"), "explains the fix");
  assertEquals(sent.length, 0, "no pointless packet sent");
});

Deno.test("AC: one effect step with a 2S2H override affects both games", async () => {
  const { dispatch, sent } = fakeDispatch();
  const res = await fns(dispatch).get("effect")!.run(
    ctxOf({
      target: "both",
      name: "FreezePlayer",
      action: "apply",
      s2h_command: "freeze",
    }),
  );
  assert(res.ok);
  if (res.ok) assertEquals(res.out?.delivered, 2);

  assertEquals(sent.length, 2);
  assertEquals(sent[0], {
    game: "soh",
    body: { type: "effect", effect: { type: "apply", name: "FreezePlayer" } },
  }, "SoH gets the named effect");
  assertEquals(sent[1], {
    game: "2s2h",
    body: { type: "command", command: "freeze" },
  }, "2S2H gets the console-command override");
});

Deno.test("effect on both without an override still does SoH, noting the gap", async () => {
  const { dispatch, sent } = fakeDispatch();
  const res = await fns(dispatch).get("effect")!.run(
    ctxOf({ target: "both", name: "OneHitKO", action: "apply" }),
  );
  assert(res.ok, "SoH was reachable, so the step succeeds");
  if (res.ok) {
    assertEquals(res.out?.games, "soh");
    assertEquals(res.out?.unsupported, "2s2h");
  }
  assertEquals(sent.length, 1);
});

Deno.test("teleport goes to 2S2H, and fails when it isn't connected", async () => {
  const live = fakeDispatch(["2s2h"]);
  const res = await fns(live.dispatch).get("teleport")!.run(
    ctxOf({ entranceId: "1234" }),
  );
  assert(res.ok);
  assertEquals(live.sent, [{
    game: "2s2h",
    body: { type: "effect", effect: { type: "teleport", entranceId: 1234 } },
  }]);

  const down = fakeDispatch(["soh"]); // only SoH up
  const off = await fns(down.dispatch).get("teleport")!.run(
    ctxOf({ entranceId: "1234" }),
  );
  assertEquals(off.ok, false);
  assertEquals(down.sent.length, 0);
});

Deno.test("teleport rejects a non-numeric entrance", async () => {
  const { dispatch, sent } = fakeDispatch();
  const res = await fns(dispatch).get("teleport")!.run(
    ctxOf({ entranceId: "somewhere" }),
  );
  assertEquals(res.ok, false);
  assertEquals(sent.length, 0);
});

// ---- sail.multi (per-game payloads, one-game-is-enough) ----

Deno.test("multi: a base command reaches every connected game", async () => {
  const { dispatch, sent } = fakeDispatch();
  const res = await fns(dispatch).get("multi")!.run(ctxOf({ command: "heal" }));
  assert(res.ok);
  assertEquals(sent, [
    { game: "soh", body: { type: "command", command: "heal" } },
    { game: "2s2h", body: { type: "command", command: "heal" } },
  ]);
});

Deno.test("multi: per-game overrides send each game its own text", async () => {
  const { dispatch, sent } = fakeDispatch();
  const res = await fns(dispatch).get("multi")!.run(ctxOf({
    soh_command: "set gMirroredWorld 1",
    s2h_command: "set gModes.MirroredWorld.Mode 1",
  }));
  assert(res.ok);
  assertEquals(sent, [
    { game: "soh", body: { type: "command", command: "set gMirroredWorld 1" } },
    {
      game: "2s2h",
      body: { type: "command", command: "set gModes.MirroredWorld.Mode 1" },
    },
  ]);
});

Deno.test("multi: an override wins over the base per game", async () => {
  const { dispatch, sent } = fakeDispatch();
  await fns(dispatch).get("multi")!.run(ctxOf({
    command: "shared",
    soh_command: "soh only",
  }));
  assertEquals(sent, [
    { game: "soh", body: { type: "command", command: "soh only" } },
    { game: "2s2h", body: { type: "command", command: "shared" } },
  ]);
});

Deno.test("AC: multi works with only one game running (mirror scenario)", async () => {
  const { dispatch, sent } = fakeDispatch(["soh"]); // 2S2H is closed
  const res = await fns(dispatch).get("multi")!.run(ctxOf({
    soh_command: "set gMirroredWorld 1",
    s2h_command: "set gModes.MirroredWorld.Mode 1",
  }));
  assert(res.ok, "succeeds even though 2S2H is offline");
  if (res.ok) assertEquals(res.out?.games, "soh");
  assertEquals(sent, [
    { game: "soh", body: { type: "command", command: "set gMirroredWorld 1" } },
  ], "only the connected game got its command; nothing failed");
});

Deno.test("multi: a game with no payload is skipped, not failed", async () => {
  const { dispatch, sent } = fakeDispatch(); // both connected
  const res = await fns(dispatch).get("multi")!.run(
    ctxOf({ soh_command: "spawn 25" }), // nothing for 2S2H
  );
  assert(res.ok);
  assertEquals(sent, [
    { game: "soh", body: { type: "command", command: "spawn 25" } },
  ]);
});

Deno.test("multi: fails (refunds) only when nothing could be sent", async () => {
  // Both games have payloads but neither is connected.
  const offline = fakeDispatch([]);
  const down = await fns(offline.dispatch).get("multi")!.run(
    ctxOf({ soh_command: "a", s2h_command: "b" }),
  );
  assertEquals(down.ok, false);
  assertEquals(offline.sent.length, 0);

  // Nothing to run at all.
  const empty = fakeDispatch();
  const blank = await fns(empty.dispatch).get("multi")!.run(ctxOf({}));
  assertEquals(blank.ok, false);
  assertEquals(empty.sent.length, 0);
});

Deno.test("an unknown target falls back to any-connected", async () => {
  const { dispatch, sent } = fakeDispatch(["2s2h"]);
  const res = await fns(dispatch).get("command")!.run(
    ctxOf({ target: "nonsense", command: "hi" }),
  );
  assert(res.ok);
  assertEquals(sent[0].game, "2s2h");
});
