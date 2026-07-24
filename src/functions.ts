// src/functions.ts — Sail command-engine functions (COM-40).
//
// The building blocks a Commander user assembles chat commands from. All of
// them are pure game control, so they need no Twitch account; any step that
// can't reach its target returns ok:false and the engine refunds the viewer.
//
// The per-game override matters because the two games aren't symmetric: SoH
// implements the ~42 named effects, while 2S2H stubs apply/remove (they return
// success without doing anything) and only really acts on console commands and
// teleports. So sail.effect takes an optional 2S2H console-command override,
// letting one logical chat command do the right thing on both games at once.

import type { FunctionResult, FunctionSpec } from "@twitch-commander/plugin";
import type { ResultStatus, SailGame } from "./protocol.ts";
import {
  describeOffline,
  GAME_LABEL,
  liveGames,
  SAIL_TARGETS,
  type SailDispatch,
  type SailTarget,
} from "./dispatch.ts";

/** SoH's named effects (SoH Sail/sail-main/types.ts, EffectName). */
export const EFFECT_NAMES: readonly string[] = [
  "SetSceneFlag",
  "UnsetSceneFlag",
  "SetFlag",
  "UnsetFlag",
  "ModifyHeartContainers",
  "FillMagic",
  "EmptyMagic",
  "ModifyRupees",
  "NoUI",
  "ModifyGravity",
  "ModifyHealth",
  "SetPlayerHealth",
  "FreezePlayer",
  "BurnPlayer",
  "ElectrocutePlayer",
  "KnockbackPlayer",
  "ModifyLinkSize",
  "InvisibleLink",
  "PacifistMode",
  "DisableZTargeting",
  "WeatherRainstorm",
  "ReverseControls",
  "ForceEquipBoots",
  "ModifyRunSpeedModifier",
  "OneHitKO",
  "ModifyDefenseModifier",
  "GiveOrTakeShield",
  "TeleportPlayer",
  "ClearAssignedButtons",
  "SetTimeOfDay",
  "SetCollisionViewer",
  "SetCosmeticsColor",
  "RandomizeCosmetics",
  "PressButton",
  "PressRandomButton",
  "AddOrTakeAmmo",
  "RandomBombFuseTimer",
  "DisableLedgeGrabs",
  "RandomWind",
  "RandomBonks",
  "PlayerInvincibility",
  "SlipperyFloor",
];

export interface SailFnDeps {
  dispatch: SailDispatch;
}

/** Split a comma-separated effect parameter list, keeping numbers numeric. */
export function parseParameters(raw: string | undefined): (number | string)[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const n = Number(part);
      return Number.isFinite(n) ? n : part;
    });
}

const ok = (out?: Record<string, unknown>): FunctionResult =>
  out ? { ok: true, out } : { ok: true };
const fail = (error: string): FunctionResult => ({ ok: false, error });

/** The target param, shared by the functions that accept one. */
export function targetParam() {
  return {
    key: "target",
    label: "Game",
    type: "select" as const,
    options: [...SAIL_TARGETS],
    default: "any",
    required: true,
  };
}

export function readTarget(raw: string | undefined): SailTarget {
  return (SAIL_TARGETS as readonly string[]).includes(raw ?? "")
    ? raw as SailTarget
    : "any";
}

/** Build every Sail function spec. */
export function buildSailFunctions(deps: SailFnDeps): FunctionSpec[] {
  const { dispatch } = deps;
  const isConnected = (game: SailGame) => dispatch.connected(game);

  return [
    {
      id: "command",
      name: "Run a console command",
      description:
        "Send a console command (e.g. `spawn 0x0018`). Works on both games.",
      requires: { account: "none" },
      params: [
        targetParam(),
        {
          key: "command",
          label: "Console command",
          type: "string",
          required: true,
        },
      ],
      run: async (ctx) => {
        const command = (ctx.params.command ?? "").trim();
        if (!command) return fail("no command was given");

        const target = readTarget(ctx.params.target);
        const games = liveGames(target, isConnected);
        if (games.length === 0) return fail(describeOffline(target));

        const results = await Promise.all(
          games.map(async (game) => ({
            game,
            status: await dispatch.send(game, { type: "command", command }),
          })),
        );
        return summarize(results);
      },
    },

    {
      id: "multi",
      name: "Per-game command",
      description:
        "Run a console command on each game, with optional per-game overrides. Sends only to connected games and succeeds if at least one accepts — so one command works whether SoH, 2S2H, or both are running. Use this whenever the console command differs between the games (e.g. mirror world).",
      requires: { account: "none" },
      params: [
        {
          key: "command",
          label: "Command (both games)",
          type: "string",
          description:
            "Sent to any connected game without a per-game override below. Leave blank if every game has its own.",
        },
        {
          key: "soh_command",
          label: "SoH command (override)",
          type: "string",
        },
        {
          key: "s2h_command",
          label: "2S2H command (override)",
          type: "string",
        },
      ],
      run: async (ctx) => {
        const base = (ctx.params.command ?? "").trim();
        const forGame: Record<SailGame, string> = {
          soh: (ctx.params.soh_command ?? "").trim() || base,
          "2s2h": (ctx.params.s2h_command ?? "").trim() || base,
        };

        // A game participates only if it has something to run.
        const wanted = (["soh", "2s2h"] as SailGame[]).filter((g) =>
          forGame[g] !== ""
        );
        if (wanted.length === 0) return fail("no command was given");

        const live = wanted.filter(isConnected);
        if (live.length === 0) {
          return fail(
            describeOffline(wanted.length === 1 ? wanted[0] : "both"),
          );
        }

        const results = await Promise.all(
          live.map(async (game) => ({
            game,
            status: await dispatch.send(game, {
              type: "command",
              command: forGame[game],
            }),
          })),
        );
        return summarize(results);
      },
    },

    {
      id: "effect",
      name: "Apply or remove an effect",
      description:
        "Fire one of SoH's named effects. 2S2H stubs effects, so set a 2S2H console-command override to cover it in the same step.",
      requires: { account: "none" },
      params: [
        targetParam(),
        {
          key: "name",
          label: "Effect",
          type: "select",
          options: [...EFFECT_NAMES],
          required: true,
        },
        {
          key: "action",
          label: "Action",
          type: "select",
          options: ["apply", "remove"],
          default: "apply",
          required: true,
        },
        {
          key: "parameters",
          label: "Parameters (comma-separated)",
          type: "string",
        },
        {
          key: "s2h_command",
          label: "2S2H console-command override",
          type: "string",
          description:
            "Sent to 2S2H instead of the effect, which 2S2H doesn't implement.",
        },
      ],
      run: async (ctx) => {
        const name = (ctx.params.name ?? "").trim();
        if (!name) return fail("no effect was given");
        const action = ctx.params.action === "remove" ? "remove" : "apply";
        const override = (ctx.params.s2h_command ?? "").trim();

        const target = readTarget(ctx.params.target);
        const games = liveGames(target, isConnected);
        if (games.length === 0) return fail(describeOffline(target));

        // 2S2H can only be covered by an override; without one it's unsupported.
        const unsupported = games.filter((g) => g === "2s2h" && !override);
        const actionable = games.filter((g) => g !== "2s2h" || override);
        if (actionable.length === 0) {
          return fail(
            `effects aren't supported on ${
              GAME_LABEL["2s2h"]
            } — set a 2S2H console-command override`,
          );
        }

        const results = await Promise.all(
          actionable.map(async (game) => {
            if (game === "2s2h") {
              return {
                game,
                status: await dispatch.send(game, {
                  type: "command",
                  command: override,
                }),
              };
            }
            const effect: Record<string, unknown> = { type: action, name };
            if (action === "apply") {
              const parameters = parseParameters(ctx.params.parameters);
              if (parameters.length > 0) effect.parameters = parameters;
            }
            return {
              game,
              status: await dispatch.send(game, {
                type: "effect",
                effect,
              }),
            };
          }),
        );

        const summary = summarize(results);
        if (summary.ok && unsupported.length > 0) {
          return ok({
            ...(summary.out ?? {}),
            unsupported: unsupported.join(","),
          });
        }
        return summary;
      },
    },

    {
      id: "teleport",
      name: "Teleport to an entrance",
      description:
        "Teleport the player to an entrance id. 2 Ship 2 Harkinian only.",
      requires: { account: "none" },
      params: [{
        key: "entranceId",
        label: "Entrance id",
        type: "number",
        required: true,
      }],
      run: async (ctx) => {
        const entranceId = Number((ctx.params.entranceId ?? "").trim());
        if (!Number.isInteger(entranceId)) {
          return fail(`"${ctx.params.entranceId}" is not an entrance id`);
        }
        if (!dispatch.connected("2s2h")) {
          return fail(`${GAME_LABEL["2s2h"]} isn't connected`);
        }
        const status = await dispatch.send("2s2h", {
          type: "effect",
          effect: { type: "teleport", entranceId },
        });
        return status === "success"
          ? ok({ games: "2s2h", entranceId })
          : fail(`2S2H reported ${status}`);
      },
    },
  ];
}

/** ok if at least one game took it; otherwise report what the games said. */
function summarize(
  results: { game: SailGame; status: ResultStatus }[],
): FunctionResult {
  const delivered = results.filter((r) => r.status === "success");
  if (delivered.length === 0) {
    const detail = results.map((r) => `${r.game}: ${r.status}`).join(", ");
    return fail(detail || "nothing was sent");
  }
  return ok({
    games: delivered.map((r) => r.game).join(","),
    delivered: delivered.length,
  });
}
