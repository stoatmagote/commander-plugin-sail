// commander-plugin-sail — control Ship of Harkinian / 2 Ship 2 Harkinian from
// Twitch.
//
// Drop this folder (or the bundled single file) into Commander's plugins/
// directory. This entry wires the pure modules to Commander's ctx:
//   - src/protocol.ts        the Sail wire format (NUL-delimited JSON) + framing
//   - src/client.ts/server.ts the TCP listeners each game dials into
//   - src/functions.ts        command-engine functions (command / effect / …)
//   - src/spawn.ts            spawn with OnActorInit confirmation
//   - src/lookups.ts          id → name resolution (bundled tables)
//   - src/catalog.ts          the spawn/give catalog + !spawn / !give commands
//   - src/launcher.ts         "run SoH / 2S2H" buttons
//   - src/tab.ts              the Sail tab (status, catalog grid, hook log)
//
// Sail is backwards from most integrations: the *games* connect to us, so this
// plugin listens on two ports (SoH 43384, 2S2H 43385 by default, both
// settings). Listeners start in setup and close in teardown, so disabling the
// plugin frees the ports and re-enabling works without restarting Commander.

import {
  type Ctx,
  definePlugin,
  type Invocation,
  type Plugin,
} from "@twitch-commander/plugin";
import { ServerDispatch } from "./src/dispatch.ts";
import { buildSailFunctions } from "./src/functions.ts";
import { annotateHook, LookupStore } from "./src/lookups.ts";
import type { SailGame, SailHook } from "./src/protocol.ts";
import { SailServer } from "./src/server.ts";
import { buildSpawnFunction, SpawnConfirmer, Spawner } from "./src/spawn.ts";
import { Catalog } from "./src/catalog.ts";
import { registerCatalogCommands } from "./src/catalog_commands.ts";
import { launchGame } from "./src/launcher.ts";
import { TAB_HTML } from "./src/tab.ts";

const LOOKUP_CACHE_KEY = "lookups_cache";
const OVERRIDES_KEY = "catalog_overrides";

const DEFAULT_SOH_PORT = 43384;
const DEFAULT_S2H_PORT = 43385;
const DEFAULT_CONFIRM_WINDOW_MS = 1500;
const MAX_RECENT_HOOKS = 60;

// Held across setup/teardown: these own OS ports, which ctx's disposables can't
// close for us. The map is mutated in place, so the dispatch handed to the
// functions keeps seeing the current servers after a port change restarts them.
const servers = new Map<SailGame, SailServer>();

// Recreated each setup so a re-enable starts clean.
let confirmer: SpawnConfirmer | undefined;
let lookups: LookupStore | undefined;
const recentHooks: string[] = [];

function stopAll(): void {
  for (const server of servers.values()) server.stop();
  servers.clear();
}

const plugin: Plugin = definePlugin({
  id: "sail",
  name: "Sail Game Control",
  version: "0.3.0",
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
      {
        key: "soh_exe",
        label: "Ship of Harkinian executable",
        type: "string",
        default: "",
        description:
          "Full path to soh.exe, for the Sail tab's Launch button. It runs with the game's own folder as the working directory.",
      },
      {
        key: "s2h_exe",
        label: "2 Ship 2 Harkinian executable",
        type: "string",
        default: "",
        description:
          "Full path to 2ship.exe, for the Sail tab's Launch button.",
      },
      {
        key: "lookups_url",
        label: "Lookups refresh URL",
        type: "string",
        default: "",
        description:
          "Base URL the Sail tab's Refresh button fetches <category>_<game>.json from. Leave blank to stick with the bundled tables.",
      },
    ]);

    confirmer = new SpawnConfirmer();

    // Names for hook ids: bundled tables, plus any cached refresh.
    lookups = new LookupStore();
    lookups.applyCache(ctx.storage.get(LOOKUP_CACHE_KEY));

    // The spawn/give catalog, with the streamer's saved enable/price overrides.
    const catalog = new Catalog();
    catalog.setOverrides(ctx.storage.get(OVERRIDES_KEY));

    const confirmEnabled = () => ctx.settings.get("spawn_confirm") === true;
    const windowMs = () => {
      const raw = Number(ctx.settings.get("spawn_confirm_window_ms"));
      return raw > 0 ? raw : DEFAULT_CONFIRM_WINDOW_MS;
    };

    const pushStatus = () =>
      ctx.ui.send({ type: "status", games: statusGames() });
    const recordHook = (game: SailGame, hook: SailHook) => {
      confirmer?.deliver(game, hook);
      const line = `[${game}] ${renderHook(game, hook)}`;
      recentHooks.push(line);
      while (recentHooks.length > MAX_RECENT_HOOKS) recentHooks.shift();
      ctx.log.debug(`[sail:${game}] ${renderHook(game, hook)}`);
      ctx.ui.send({ type: "hook", line });
    };

    const port = (key: string, fallback: number) => {
      const raw = Number(ctx.settings.get(key));
      return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : fallback;
    };
    const startAll = () => {
      stopAll();
      for (
        const [game, key] of [
          ["soh", "soh_port"],
          ["2s2h", "s2h_port"],
        ] as [SailGame, string][]
      ) {
        const fallback = game === "soh" ? DEFAULT_SOH_PORT : DEFAULT_S2H_PORT;
        servers.set(
          game,
          new SailServer({
            game,
            port: port(key, fallback),
            log: ctx.log,
            onHook: recordHook,
            onConnect: pushStatus,
            onDisconnect: pushStatus,
          }),
        );
      }
      for (const server of servers.values()) server.start();
    };
    startAll();

    // Functions + the spawn function share one Spawner (and its confirmer +
    // 2S2H subscription refcount).
    const dispatch = new ServerDispatch(servers);
    const spawner = new Spawner(dispatch, confirmer);
    for (const spec of buildSailFunctions({ dispatch })) {
      ctx.functions.register(spec);
    }
    ctx.functions.register(
      buildSpawnFunction({ dispatch, spawner, confirmEnabled, windowMs }),
    );

    // The named catalog commands.
    registerCatalogCommands(ctx, {
      catalog,
      dispatch,
      spawner,
      points: ctx.points,
      chat: ctx.chat,
      confirmEnabled,
      windowMs,
      log: ctx.log,
    });

    // The Sail tab.
    ctx.ui.registerTab({ id: "sail", title: "Sail", html: TAB_HTML });
    ctx.ui.onRequest((raw) => handleTabRequest(ctx, catalog, raw));

    // A port change has to rebind, or the games would dial a stale port.
    ctx.settings.onChange((key) => {
      if (key === "soh_port" || key === "s2h_port") {
        ctx.log.info("port changed — restarting the Sail listeners");
        startAll();
        pushStatus();
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
    lookups = undefined;
    recentHooks.length = 0;
  },
});

export default plugin;

/** Per-game status for the tab. */
function statusGames() {
  return [...servers.values()].map((server) => ({
    game: server.game,
    connected: server.connected,
    listening: server.listening,
    port: server.port,
    error: server.error,
  }));
}

/** Handle a request from the Sail tab. */
async function handleTabRequest(
  ctx: Ctx,
  catalog: Catalog,
  raw: unknown,
): Promise<unknown> {
  const req = (raw ?? {}) as Record<string, unknown>;
  switch (req.type) {
    case "status":
      return { games: statusGames() };
    case "recent":
      return { hooks: [...recentHooks] };
    case "launch": {
      const game = req.game === "2s2h" ? "2s2h" : "soh";
      const exe = String(
        ctx.settings.get(game === "soh" ? "soh_exe" : "s2h_exe") || "",
      );
      const result = launchGame(exe);
      if (result.ok) ctx.log.info(`launched ${game}: ${exe}`);
      else ctx.log.warn(`launch ${game} failed: ${result.error}`);
      return result;
    }
    case "rows": {
      const kind = req.kind === "item" ? "item" : "actor";
      const filter = typeof req.filter === "string" ? req.filter : "";
      const rows = catalog.rows(kind, filter);
      const total = kind === "actor" ? catalog.actorCount : catalog.itemCount;
      return { rows, total };
    }
    case "toggle": {
      const kind = req.entryKind === "item" ? "item" : "actor";
      catalog.setOverride(kind, String(req.key), {
        enabled: req.enabled === true,
      });
      ctx.storage.set(OVERRIDES_KEY, catalog.overrides());
      return { ok: true };
    }
    case "price": {
      const kind = req.entryKind === "item" ? "item" : "actor";
      const price = typeof req.price === "number" && req.price >= 0
        ? req.price
        : undefined;
      catalog.setOverride(kind, String(req.key), { price });
      ctx.storage.set(OVERRIDES_KEY, catalog.overrides());
      return { ok: true };
    }
    case "refresh-lookups": {
      const url = String(ctx.settings.get("lookups_url") || "").trim();
      if (!url) return { error: "set a Lookups refresh URL in settings first" };
      if (!lookups) return { error: "not ready" };
      const results = await lookups.refresh((u) => fetch(u), url);
      ctx.storage.set(LOOKUP_CACHE_KEY, lookups.snapshot());
      return { results };
    }
    default:
      return { error: "unknown request" };
  }
}

/** A one-line rendering of a hook, with ids resolved to names when we can. */
function renderHook(game: SailGame, hook: SailHook): string {
  if (lookups) return annotateHook(game, hook, lookups);
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
