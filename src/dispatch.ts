// src/dispatch.ts — deciding which game(s) a step acts on (COM-40).
//
// Every game-control function takes a target: one specific game, both, or
// "whichever is connected". Resolving that is pure (liveGames), and the actual
// sending sits behind a tiny interface so the functions unit-test with no
// sockets at all.

import type { OutgoingBody, ResultStatus, SailGame } from "./protocol.ts";
import type { SailServer } from "./server.ts";

/** The fixed choices the command editor offers for a target. */
export type SailTarget = "soh" | "2s2h" | "both" | "any";

/**
 * What a target field may actually hold: one of the fixed choices above, or an
 * explicit comma-separated list of games (`"soh,2s2h"`) — which is how a step
 * aims at exactly the games an earlier step acted on.
 */
export type TargetSpec = string;

export const SAIL_TARGETS: readonly SailTarget[] = [
  "soh",
  "2s2h",
  "both",
  "any",
];

/** Display names for chat/log messages. */
export const GAME_LABEL: Record<SailGame, string> = {
  soh: "Ship of Harkinian",
  "2s2h": "2 Ship 2 Harkinian",
};

/** What the functions need from the servers — faked in tests. */
export interface SailDispatch {
  connected(game: SailGame): boolean;
  send(game: SailGame, body: OutgoingBody): Promise<ResultStatus>;
}

/** The games a target names, ignoring whether they're connected. */
export function intendedGames(target: TargetSpec): SailGame[] {
  if (target === "soh") return ["soh"];
  if (target === "2s2h") return ["2s2h"];
  // An explicit list — "soh,2s2h" — is how one step aims at exactly the games
  // an earlier step acted on (sail.spawn reports them as {step1.out.games}).
  // Without this, announcing a spawn means re-resolving "any"/"both" from
  // scratch, and a SoH-only actor gets announced in 2S2H as well.
  if (target.includes(",")) {
    const named = target.split(",").map((g) => g.trim());
    return (["soh", "2s2h"] as SailGame[]).filter((g) => named.includes(g));
  }
  return ["soh", "2s2h"];
}

/**
 * The games a target actually resolves to right now:
 *   soh / 2s2h → that game, only if it's connected
 *   both       → every connected game
 *   any        → the first connected game (SoH preferred)
 * An empty result means "nothing to send to" — the caller fails the step so the
 * command engine refunds.
 */
export function liveGames(
  target: TargetSpec,
  isConnected: (game: SailGame) => boolean,
): SailGame[] {
  const live = intendedGames(target).filter(isConnected);
  return target === "any" ? live.slice(0, 1) : live;
}

/** A human explanation of why a target resolved to nothing. */
export function describeOffline(target: TargetSpec): string {
  if (target === "both" || target === "any") return "no game is connected";
  const games = intendedGames(target);
  if (games.length === 0) return "no game is connected";
  return `${games.map((g) => GAME_LABEL[g]).join(" or ")} isn't connected`;
}

/** The real dispatch: sends through whichever client a game's server holds. */
export class ServerDispatch implements SailDispatch {
  #servers: Map<SailGame, SailServer>;

  /** Holds the live map, so restarting the listeners doesn't stale this out. */
  constructor(servers: Map<SailGame, SailServer>) {
    this.#servers = servers;
  }

  connected(game: SailGame): boolean {
    return this.#servers.get(game)?.connected ?? false;
  }

  send(game: SailGame, body: OutgoingBody): Promise<ResultStatus> {
    const client = this.#servers.get(game)?.clients[0];
    if (!client) return Promise.resolve("failure");
    return client.send(body);
  }
}
