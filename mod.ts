// commander-plugin-sail — control Ship of Harkinian / 2 Ship 2 Harkinian from
// Twitch.
//
// Drop this folder (or the bundled single file) into Commander's plugins/
// directory. This entry wires the pure modules to Commander's ctx:
//   - src/protocol.ts  the Sail wire format (NUL-delimited JSON) + framing
//   - src/client.ts    one connected game: correlated sends, retries, hooks
//   - src/server.ts    the TCP listener each game dials into
//
// Sail is backwards from most integrations: the *games* connect to us, so this
// plugin listens on two ports (SoH 43384, 2S2H 43385 by default, both
// settings). Listeners start in setup and close in teardown, so disabling the
// plugin frees the ports and re-enabling works without restarting Commander.
//
// Still to come: game-control functions (COM-40), spawn confirmation (COM-45),
// lookup tables (COM-41), catalog commands + the Sail tab (COM-50).

import {
  type Ctx,
  definePlugin,
  type Invocation,
  type Plugin,
} from "@twitch-commander/plugin";
import { ServerDispatch } from "./src/dispatch.ts";
import { buildSailFunctions } from "./src/functions.ts";
import type { SailGame, SailHook } from "./src/protocol.ts";
import { SailServer } from "./src/server.ts";
import { buildSpawnFunction, SpawnConfirmer } from "./src/spawn.ts";

const DEFAULT_SOH_PORT = 43384;
const DEFAULT_S2H_PORT = 43385;
const DEFAULT_CONFIRM_WINDOW_MS = 1500;

// Held across setup/teardown: these own OS ports, which ctx's disposables can't
// close for us. The map is mutated in place rather than replaced, so the
// dispatch handed to the functions keeps seeing the current servers after a
// port change restarts them.
const servers = new Map<SailGame, SailServer>();

// Confirms spawns from OnActorInit hooks. Recreated each setup so a re-enable
// starts clean; every hook is fed to it.
let confirmer: SpawnConfirmer | undefined;

function stopAll(): void {
  for (const server of servers.values()) server.stop();
  servers.clear();
}

const plugin: Plugin = definePlugin({
  id: "sail",
  name: "Sail Game Control",
  version: "0.2.0",
  update: "github:stoatmagote/commander-plugin-sail",
  apiVersion: 1,

  setup(ctx: Ctx) {
    ctx.settings.define([
      {
        key: "soh_port",
        label: "Ship of Harkinian port",
        type: "number",
        default: DEFAULT_SOH_PORT,
        description:
          "The port SoH's Sail connects to. Must match the game's setting.",
      },
      {
        key: "s2h_port",
        label: "2 Ship 2 Harkinian port",
        type: "number",
        default: DEFAULT_S2H_PORT,
        description:
          "The port 2S2H's Sail connects to. Must match the game's setting.",
      },
      {
        key: "spawn_confirm",
        label: "Confirm spawns",
        type: "boolean",
        default: true,
        description:
          "Wait for the game to confirm a spawn (OnActorInit) before charging. Off = charge as soon as the command is accepted.",
      },
      {
        key: "spawn_confirm_window_ms",
        label: "Spawn confirm window (ms)",
        type: "number",
        default: DEFAULT_CONFIRM_WINDOW_MS,
        description:
          "How long to wait for a spawn's OnActorInit before refunding.",
      },
    ]);

    const port = (key: string, fallback: number) => {
      const raw = Number(ctx.settings.get(key));
      return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : fallback;
    };

    const startAll = () => {
      stopAll();
      servers.set(
        "soh",
        makeServer(ctx, "soh", port("soh_port", DEFAULT_SOH_PORT)),
      );
      servers.set(
        "2s2h",
        makeServer(ctx, "2s2h", port("s2h_port", DEFAULT_S2H_PORT)),
      );
      for (const server of servers.values()) server.start();
    };
    confirmer = new SpawnConfirmer();
    startAll();

    // Game-control functions: the building blocks for chat commands.
    const dispatch = new ServerDispatch(servers);
    for (const spec of buildSailFunctions({ dispatch })) {
      ctx.functions.register(spec);
    }
    ctx.functions.register(buildSpawnFunction({
      dispatch,
      confirmer,
      confirmEnabled: () => ctx.settings.get("spawn_confirm") === true,
      windowMs: () => {
        const raw = Number(ctx.settings.get("spawn_confirm_window_ms"));
        return raw > 0 ? raw : DEFAULT_CONFIRM_WINDOW_MS;
      },
    }));

    // A port change has to rebind, or the games would dial a stale port.
    ctx.settings.onChange((key) => {
      if (key === "soh_port" || key === "s2h_port") {
        ctx.log.info("port changed — restarting the Sail listeners");
        startAll();
      }
    });

    ctx.commands.register({
      trigger: "sail",
      usableBy: "streamer",
      run: (inv) => reportStatus(ctx, inv),
    });
  },

  teardown() {
    stopAll();
    confirmer?.cancelAll();
    confirmer = undefined;
  },
});

export default plugin;

function makeServer(ctx: Ctx, game: SailGame, port: number): SailServer {
  return new SailServer({
    game,
    port,
    log: ctx.log,
    onHook: (g, hook) => {
      confirmer?.deliver(g, hook);
      ctx.log.debug(`[sail:${g}] ${describeHook(hook)}`);
    },
  });
}

/** A compact one-line rendering of a hook. Names come with COM-41's lookups. */
function describeHook(hook: SailHook): string {
  const fields = Object.entries(hook)
    .filter(([key]) => key !== "type")
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return fields ? `${hook.type} ${fields}` : hook.type;
}

/** `!sail` — report which games are connected. */
function reportStatus(ctx: Ctx, inv: Invocation): Promise<void> {
  const label: Record<SailGame, string> = { soh: "SoH", "2s2h": "2S2H" };
  const parts = [...servers.values()].map((server) => {
    if (server.error) return `${label[server.game]}: port error`;
    if (!server.listening) return `${label[server.game]}: off`;
    return `${label[server.game]}: ${
      server.connected ? "connected" : `waiting on ${server.port}`
    }`;
  });
  const text = parts.length > 0 ? parts.join(" | ") : "Sail isn't listening.";
  return ctx.chat.send(text, { replyTo: inv.messageId }).then(() => {}).catch(
    () => {},
  );
}
