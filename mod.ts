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
import type { SailGame, SailHook } from "./src/protocol.ts";
import { SailServer } from "./src/server.ts";

const DEFAULT_SOH_PORT = 43384;
const DEFAULT_S2H_PORT = 43385;

// Held across setup/teardown: these own OS ports, which ctx's disposables can't
// close for us.
let servers: SailServer[] = [];

function stopAll(): void {
  for (const server of servers) server.stop();
  servers = [];
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
    ]);

    const port = (key: string, fallback: number) => {
      const raw = Number(ctx.settings.get(key));
      return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : fallback;
    };

    const startAll = () => {
      stopAll();
      servers = [
        makeServer(ctx, "soh", port("soh_port", DEFAULT_SOH_PORT)),
        makeServer(ctx, "2s2h", port("s2h_port", DEFAULT_S2H_PORT)),
      ];
      for (const server of servers) server.start();
    };
    startAll();

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
  },
});

export default plugin;

function makeServer(ctx: Ctx, game: SailGame, port: number): SailServer {
  return new SailServer({
    game,
    port,
    log: ctx.log,
    onHook: (g, hook) => ctx.log.debug(`[sail:${g}] ${describeHook(hook)}`),
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
  const parts = servers.map((server) => {
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
