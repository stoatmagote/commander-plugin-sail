// src/dispatch.ts — deciding which game(s) a step acts on (COM-40).
//
// Every game-control function takes a target: one specific game, both, or
// "whichever is connected". Resolving that is pure (liveGames), and the actual
// sending sits behind a tiny interface so the functions unit-test with no
// sockets at all.

import type { OutgoingBody, ResultStatus, SailGame } from "./protocol.ts";
import type { SailServer } from "./server.ts";

/** Who a step is aimed at. */
export type SailTarget = "soh" | "2s2h" | "both" | "any";

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
export function intendedGames(target: SailTarget): SailGame[] {
  if (target === "soh") return ["soh"];
  if (target === "2s2h") return ["2s2h"];
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
  target: SailTarget,
  isConnected: (game: SailGame) => boolean,
): SailGame[] {
  const live = intendedGames(target).filter(isConnected);
  return target === "any" ? live.slice(0, 1) : live;
}

/** A human explanation of why a target resolved to nothing. */
export function describeOffline(target: SailTarget): string {
  if (target === "both" || target === "any") return "no game is connected";
  return `${GAME_LABEL[intendedGames(target)[0]]} isn't connected`;
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
