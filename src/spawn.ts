// src/spawn.ts — spawn an actor and wait for the game to confirm it (COM-45).
//
// A spawn console command only tells us the command *parsed* — not that the
// actor actually appeared (it may be invalid in the current scene). So spawn
// sends the command, then waits for a matching `OnActorInit` hook within a
// window; no hook means the step fails and the engine refunds the viewer.
//
// Because Commander runs the plugin in-process, this replaces the legacy
// out-of-process design (send now, sweep + refund later): the function simply
// doesn't return until the game confirms or the window expires.
//
// Concurrency: two spawns of the same actor id are matched FIFO — the first
// OnActorInit resolves the oldest waiter (ported from the legacy commander's
// onActorInit()). Matching is keyed by (game, actorId), so a hook can never
// confirm a spawn of a different actor.

import type { FunctionResult, FunctionSpec } from "@twitch-commander/plugin";
import type { SailGame, SailHook } from "./protocol.ts";
import { describeOffline, liveGames, type SailDispatch } from "./dispatch.ts";
import { readTarget, targetParam } from "./functions.ts";
import type { Catalog } from "./catalog.ts";

/** Verbs whose console command spawns an actor (legacy parseSpawnActorId). */
export const SPAWN_VERBS: readonly string[] = [
  "spawn",
  "safespawn",
  "spawnfwd",
];

/** Pull the actor id from a `spawn|safespawn|spawnfwd <id> …` command. */
export function parseSpawnActorId(command: string): number | null {
  const m = command.match(/^\s*(?:spawn|safespawn|spawnfwd)\s+(\d+)/i);
  return m ? Number(m[1]) : null;
}

/** Parse a user-supplied actor id — decimal or 0x-hex — to a number. */
export function parseActorId(raw: string | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const n = /^0x/i.test(s) ? parseInt(s.slice(2), 16) : Number(s);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Build the console command a spawn sends (ids go out as decimal). */
export function buildSpawnCommand(
  verb: string,
  actorId: number,
  params: string,
): string {
  const v = SPAWN_VERBS.includes(verb) ? verb : "spawn";
  const extra = params.trim();
  return extra ? `${v} ${actorId} ${extra}` : `${v} ${actorId}`;
}

interface Waiter {
  game: SailGame;
  actorId: number;
  settle: (confirmed: boolean) => void;
}

/** A registered wait for an OnActorInit; cancel() resolves it false early. */
export interface SpawnWait {
  confirmed: Promise<boolean>;
  cancel(): void;
}

/**
 * Tracks in-flight spawns and confirms them from OnActorInit hooks, FIFO per
 * (game, actorId). Feed every hook to deliver(); register a wait with await().
 * Timers are injected so the timeout is testable.
 */
export class SpawnConfirmer {
  #waiters: Waiter[] = [];
  #setTimer: (fn: () => void, ms: number) => number;
  #clearTimer: (handle: number) => void;

  constructor(timers?: {
    setTimer: (fn: () => void, ms: number) => number;
    clearTimer: (handle: number) => void;
  }) {
    this.#setTimer = timers?.setTimer ??
      ((fn, ms) => setTimeout(fn, ms) as unknown as number);
    this.#clearTimer = timers?.clearTimer ??
      ((h) => clearTimeout(h));
  }

  get pending(): number {
    return this.#waiters.length;
  }

  /** Wait for an OnActorInit matching (game, actorId) within timeoutMs. */
  await(game: SailGame, actorId: number, timeoutMs: number): SpawnWait {
    let done = false;
    let timer: number;
    const waiter: Waiter = { game, actorId, settle: () => {} };

    const confirmed = new Promise<boolean>((resolve) => {
      waiter.settle = (value) => {
        if (done) return;
        done = true;
        this.#clearTimer(timer);
        this.#remove(waiter);
        resolve(value);
      };
      timer = this.#setTimer(() => waiter.settle(false), timeoutMs);
    });

    this.#waiters.push(waiter);
    return { confirmed, cancel: () => waiter.settle(false) };
  }

  /** Feed a hook; an OnActorInit confirms the oldest matching waiter. */
  deliver(game: SailGame, hook: SailHook): void {
    if (hook.type !== "OnActorInit") return;
    const actorId = Number(hook.actorId);
    if (!Number.isInteger(actorId)) return;
    const waiter = this.#waiters.find(
      (w) => w.game === game && w.actorId === actorId,
    );
    waiter?.settle(true);
  }

  /** Fail every in-flight wait (teardown). */
  cancelAll(): void {
    for (const waiter of [...this.#waiters]) waiter.settle(false);
  }

  #remove(waiter: Waiter): void {
    const idx = this.#waiters.indexOf(waiter);
    if (idx !== -1) this.#waiters.splice(idx, 1);
  }
}

export interface SpawnOptions {
  verb?: string;
  extra?: string;
  confirm: boolean;
  windowMs: number;
}

/**
 * Spawns actors and (optionally) confirms them, sharing the SpawnConfirmer and
 * the 2S2H OnActorInit subscription refcount across every caller — both
 * sail.spawn and the catalog !spawn command go through one Spawner.
 */
export class Spawner {
  #dispatch: SailDispatch;
  #confirmer: SpawnConfirmer;
  // 2S2H doesn't push OnActorInit by default (too chatty), so we subscribe to
  // it filtered to the actor id, and unsubscribe when the last concurrent spawn
  // of that id finishes. Refcounted per actor id.
  #s2hSubs = new Map<number, number>();

  constructor(dispatch: SailDispatch, confirmer: SpawnConfirmer) {
    this.#dispatch = dispatch;
    this.#confirmer = confirmer;
  }

  /** Spawn one actor on one game; resolves true only if it was confirmed. */
  async spawn(
    game: SailGame,
    actorId: number,
    opts: SpawnOptions,
  ): Promise<boolean> {
    const command = buildSpawnCommand(
      opts.verb ?? "spawn",
      actorId,
      opts.extra ?? "",
    );
    if (!opts.confirm) {
      const status = await this.#dispatch.send(game, {
        type: "command",
        command,
      });
      return status === "success";
    }

    if (game === "2s2h") await this.#acquire2s2h(actorId);
    try {
      // Register the wait BEFORE sending, so a fast OnActorInit isn't missed.
      const wait = this.#confirmer.await(game, actorId, opts.windowMs);
      const status = await this.#dispatch.send(game, {
        type: "command",
        command,
      });
      if (status !== "success") {
        wait.cancel(); // parse/refused — don't burn the whole window
        return false;
      }
      return await wait.confirmed;
    } finally {
      if (game === "2s2h") await this.#release2s2h(actorId);
    }
  }

  async #acquire2s2h(actorId: number): Promise<void> {
    const count = this.#s2hSubs.get(actorId) ?? 0;
    this.#s2hSubs.set(actorId, count + 1);
    if (count === 0) {
      await this.#dispatch.send("2s2h", {
        type: "subscribe",
        eventName: "OnActorInit",
        eventIdFilter: actorId,
      });
    }
  }

  async #release2s2h(actorId: number): Promise<void> {
    const count = (this.#s2hSubs.get(actorId) ?? 1) - 1;
    if (count <= 0) {
      this.#s2hSubs.delete(actorId);
      await this.#dispatch.send("2s2h", {
        type: "unsubscribe",
        eventName: "OnActorInit",
        eventIdFilter: actorId,
      });
    } else {
      this.#s2hSubs.set(actorId, count);
    }
  }
}

export interface SpawnFnDeps {
  dispatch: SailDispatch;
  spawner: Spawner;
  /**
   * The catalog, so an actor can be named rather than numbered. The same actor
   * has a different id in each game, which is why resolution happens per game
   * inside the function rather than in whatever passed the argument.
   */
  catalog?: Catalog;
  /** Whether to wait for OnActorInit (a plugin setting; read fresh). */
  confirmEnabled: () => boolean;
  /** How long to wait for confirmation, ms (a plugin setting; read fresh). */
  windowMs: () => number;
}

const ok = (out: Record<string, unknown>): FunctionResult => ({
  ok: true,
  out,
});
const fail = (error: string): FunctionResult => ({ ok: false, error });

/** Build the sail.spawn function (an actor id, or a name from the catalog). */
export function buildSpawnFunction(deps: SpawnFnDeps): FunctionSpec {
  const { dispatch, spawner } = deps;
  const isConnected = (game: SailGame) => dispatch.connected(game);

  return {
    id: "spawn",
    name: "Spawn an actor",
    description:
      "Spawn an actor by id and confirm it appeared (via OnActorInit) before charging. No confirmation → the viewer is refunded.",
    requires: { account: "none" },
    params: [
      targetParam(),
      {
        key: "actorId",
        label: "Actor (id, 0x-hex, or catalog key)",
        type: "string",
        required: true,
      },
      {
        key: "verb",
        label: "Spawn command",
        type: "select",
        options: [...SPAWN_VERBS],
        default: "safespawn",
      },
      {
        // The games aren't symmetric: 2S2H has the custom `safespawn` (which
        // preloads the actor's object and places it in front of the player),
        // SoH only has vanilla `spawn`, which drops the actor on top of you and
        // fails for objects the scene hasn't loaded. Sending safespawn to SoH
        // is just an unknown command, so it gets its own verb until it's
        // patched to match.
        key: "soh_verb",
        label: "Spawn command for SoH",
        type: "select",
        options: [...SPAWN_VERBS],
        default: "spawn",
      },
      {
        key: "params",
        label: "Extra arguments",
        type: "string",
      },
    ],
    run: async (ctx) => {
      const raw = (ctx.params.actorId ?? "").trim();
      const target = readTarget(ctx.params.target);
      const games = liveGames(target, isConnected);
      if (games.length === 0) return fail(describeOffline(target));

      // A literal id is the same number everywhere; a catalog key — what the
      // `sail.actors` option list hands over — has to be resolved per game,
      // since the same actor is numbered differently in SoH and 2S2H.
      const literal = parseActorId(raw);
      const entry = literal === null
        ? deps.catalog?.actorByKey(raw)
        : undefined;
      if (literal === null && !entry) {
        return fail(`"${raw}" is not an actor id`);
      }

      const targets = games
        .map((game) => ({
          game,
          actorId: literal ?? deps.catalog!.actorId(entry!, game),
        }))
        .filter((t): t is { game: SailGame; actorId: number } =>
          t.actorId !== undefined
        );
      if (targets.length === 0) {
        return fail(`${entry?.name ?? raw} isn't in the connected game`);
      }

      const verbFor = (game: SailGame) =>
        game === "soh"
          ? (ctx.params.soh_verb || ctx.params.verb || "spawn")
          : (ctx.params.verb || "spawn");
      const opts = {
        extra: ctx.params.params ?? "",
        confirm: deps.confirmEnabled(),
        windowMs: deps.windowMs(),
      };
      // Every targeted game must confirm; otherwise the viewer is refunded.
      const results = await Promise.all(
        targets.map((t) =>
          spawner.spawn(t.game, t.actorId, { ...opts, verb: verbFor(t.game) })
        ),
      );
      if (!results.every(Boolean)) {
        return fail(
          deps.confirmEnabled()
            ? `spawn not confirmed within ${deps.windowMs()}ms`
            : "the spawn wasn't accepted",
        );
      }
      return ok({
        actorId: targets[0].actorId,
        name: entry?.name ?? raw,
        games: targets.map((t) => t.game).join(","),
        confirmed: targets.length,
      });
    },
  };
}
