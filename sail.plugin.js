// ../Commander/plugin-api/mod.ts
function definePlugin(plugin2) {
  return plugin2;
}

// src/dispatch.ts
var SAIL_TARGETS = [
  "soh",
  "2s2h",
  "both",
  "any"
];
var GAME_LABEL = {
  soh: "Ship of Harkinian",
  "2s2h": "2 Ship 2 Harkinian"
};
function intendedGames(target) {
  if (target === "soh") return [
    "soh"
  ];
  if (target === "2s2h") return [
    "2s2h"
  ];
  return [
    "soh",
    "2s2h"
  ];
}
function liveGames(target, isConnected) {
  const live = intendedGames(target).filter(isConnected);
  return target === "any" ? live.slice(0, 1) : live;
}
function describeOffline(target) {
  if (target === "both" || target === "any") return "no game is connected";
  return `${GAME_LABEL[intendedGames(target)[0]]} isn't connected`;
}
var ServerDispatch = class {
  #servers;
  /** Holds the live map, so restarting the listeners doesn't stale this out. */
  constructor(servers2) {
    this.#servers = servers2;
  }
  connected(game) {
    return this.#servers.get(game)?.connected ?? false;
  }
  send(game, body) {
    const client = this.#servers.get(game)?.clients[0];
    if (!client) return Promise.resolve("failure");
    return client.send(body);
  }
};

// src/functions.ts
var EFFECT_NAMES = [
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
  "SlipperyFloor"
];
function parseParameters(raw) {
  if (!raw) return [];
  return raw.split(",").map((part) => part.trim()).filter((part) => part.length > 0).map((part) => {
    const n = Number(part);
    return Number.isFinite(n) ? n : part;
  });
}
var ok = (out) => out ? {
  ok: true,
  out
} : {
  ok: true
};
var fail = (error) => ({
  ok: false,
  error
});
function targetParam() {
  return {
    key: "target",
    label: "Game",
    type: "select",
    options: [
      ...SAIL_TARGETS
    ],
    default: "any",
    required: true
  };
}
function readTarget(raw) {
  return SAIL_TARGETS.includes(raw ?? "") ? raw : "any";
}
function buildSailFunctions(deps) {
  const { dispatch } = deps;
  const isConnected = (game) => dispatch.connected(game);
  return [
    {
      id: "command",
      name: "Run a console command",
      description: "Send a console command (e.g. `spawn 0x0018`). Works on both games.",
      requires: {
        account: "none"
      },
      params: [
        targetParam(),
        {
          key: "command",
          label: "Console command",
          type: "string",
          required: true
        }
      ],
      run: async (ctx) => {
        const command = (ctx.params.command ?? "").trim();
        if (!command) return fail("no command was given");
        const target = readTarget(ctx.params.target);
        const games = liveGames(target, isConnected);
        if (games.length === 0) return fail(describeOffline(target));
        const results = await Promise.all(games.map(async (game) => ({
          game,
          status: await dispatch.send(game, {
            type: "command",
            command
          })
        })));
        return summarize(results);
      }
    },
    {
      id: "effect",
      name: "Apply or remove an effect",
      description: "Fire one of SoH's named effects. 2S2H stubs effects, so set a 2S2H console-command override to cover it in the same step.",
      requires: {
        account: "none"
      },
      params: [
        targetParam(),
        {
          key: "name",
          label: "Effect",
          type: "select",
          options: [
            ...EFFECT_NAMES
          ],
          required: true
        },
        {
          key: "action",
          label: "Action",
          type: "select",
          options: [
            "apply",
            "remove"
          ],
          default: "apply",
          required: true
        },
        {
          key: "parameters",
          label: "Parameters (comma-separated)",
          type: "string"
        },
        {
          key: "s2h_command",
          label: "2S2H console-command override",
          type: "string",
          description: "Sent to 2S2H instead of the effect, which 2S2H doesn't implement."
        }
      ],
      run: async (ctx) => {
        const name = (ctx.params.name ?? "").trim();
        if (!name) return fail("no effect was given");
        const action = ctx.params.action === "remove" ? "remove" : "apply";
        const override = (ctx.params.s2h_command ?? "").trim();
        const target = readTarget(ctx.params.target);
        const games = liveGames(target, isConnected);
        if (games.length === 0) return fail(describeOffline(target));
        const unsupported = games.filter((g) => g === "2s2h" && !override);
        const actionable = games.filter((g) => g !== "2s2h" || override);
        if (actionable.length === 0) {
          return fail(`effects aren't supported on ${GAME_LABEL["2s2h"]} \u2014 set a 2S2H console-command override`);
        }
        const results = await Promise.all(actionable.map(async (game) => {
          if (game === "2s2h") {
            return {
              game,
              status: await dispatch.send(game, {
                type: "command",
                command: override
              })
            };
          }
          const effect = {
            type: action,
            name
          };
          if (action === "apply") {
            const parameters = parseParameters(ctx.params.parameters);
            if (parameters.length > 0) effect.parameters = parameters;
          }
          return {
            game,
            status: await dispatch.send(game, {
              type: "effect",
              effect
            })
          };
        }));
        const summary = summarize(results);
        if (summary.ok && unsupported.length > 0) {
          return ok({
            ...summary.out ?? {},
            unsupported: unsupported.join(",")
          });
        }
        return summary;
      }
    },
    {
      id: "teleport",
      name: "Teleport to an entrance",
      description: "Teleport the player to an entrance id. 2 Ship 2 Harkinian only.",
      requires: {
        account: "none"
      },
      params: [
        {
          key: "entranceId",
          label: "Entrance id",
          type: "number",
          required: true
        }
      ],
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
          effect: {
            type: "teleport",
            entranceId
          }
        });
        return status === "success" ? ok({
          games: "2s2h",
          entranceId
        }) : fail(`2S2H reported ${status}`);
      }
    }
  ];
}
function summarize(results) {
  const delivered = results.filter((r) => r.status === "success");
  if (delivered.length === 0) {
    const detail = results.map((r) => `${r.game}: ${r.status}`).join(", ");
    return fail(detail || "nothing was sent");
  }
  return ok({
    games: delivered.map((r) => r.game).join(","),
    delivered: delivered.length
  });
}

// src/protocol.ts
var TS2H_DEFAULT_HOOKS = [
  "OnSceneInit",
  "OnItemGive",
  "OnFlagSet",
  "OnFlagUnset",
  "OnSceneFlagSet",
  "OnSceneFlagUnset"
];
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function encodePacket(packet) {
  return encoder.encode(JSON.stringify(packet) + "\0");
}
function parseIncoming(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw;
  if (obj.type === "result" && typeof obj.id === "string") {
    const status = obj.status;
    if (status === "success" || status === "failure" || status === "try_again" || status === "timeout") {
      return {
        id: obj.id,
        type: "result",
        status
      };
    }
    return null;
  }
  if (obj.type === "hook") {
    const hook = obj.hook;
    if (hook && typeof hook === "object" && typeof hook.type === "string") {
      return {
        type: "hook",
        hook
      };
    }
  }
  return null;
}
function newPacketId() {
  return crypto.randomUUID();
}
var PacketFramer = class {
  #buffer = new Uint8Array(0);
  push(chunk) {
    const merged = new Uint8Array(this.#buffer.length + chunk.length);
    merged.set(this.#buffer);
    merged.set(chunk, this.#buffer.length);
    this.#buffer = merged;
    const packets = [];
    let start = 0;
    for (let i = 0; i < this.#buffer.length; i++) {
      if (this.#buffer[i] !== 0) continue;
      const body = this.#buffer.subarray(start, i);
      if (body.length > 0) packets.push(decoder.decode(body));
      start = i + 1;
    }
    this.#buffer = this.#buffer.slice(start);
    return packets;
  }
  /** Bytes buffered awaiting a terminator (diagnostics / tests). */
  get pending() {
    return this.#buffer.length;
  }
};

// src/client.ts
var nextClientId = 1;
var SailClient = class {
  game;
  id;
  #conn;
  #log;
  #onHook;
  #onClose;
  #framer = new PacketFramer();
  #pending = /* @__PURE__ */ new Map();
  #closed = false;
  #timeoutMs;
  #retryDelayMs;
  #maxRetries;
  constructor(deps) {
    this.#conn = deps.conn;
    this.game = deps.game;
    this.id = nextClientId++;
    this.#log = deps.log;
    this.#onHook = deps.onHook;
    this.#onClose = deps.onClose;
    this.#timeoutMs = deps.timeoutMs ?? 5e3;
    this.#retryDelayMs = deps.retryDelayMs ?? 500;
    this.#maxRetries = deps.maxRetries ?? 5;
    void this.#readLoop();
  }
  get closed() {
    return this.#closed;
  }
  /** Send a console command (the channel both games support). */
  command(command) {
    return this.send({
      type: "command",
      command
    });
  }
  /** Send an effect packet (apply/remove/command/teleport shapes). */
  effect(effect) {
    return this.send({
      type: "effect",
      effect
    });
  }
  /** Subscribe to a hook (2S2H emits nothing until you do). */
  subscribe(eventName, eventIdFilter) {
    const body = {
      type: "subscribe",
      eventName
    };
    if (eventIdFilter !== void 0) body.eventIdFilter = eventIdFilter;
    return this.send(body);
  }
  /** Stop receiving a hook previously subscribed to. */
  unsubscribe(eventName, eventIdFilter) {
    const body = {
      type: "unsubscribe",
      eventName
    };
    if (eventIdFilter !== void 0) body.eventIdFilter = eventIdFilter;
    return this.send(body);
  }
  /**
   * Send a packet and resolve with the game's verdict, retrying "try_again".
   * Never rejects.
   */
  async send(body) {
    let status = "failure";
    for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
      if (this.#closed) return "failure";
      status = await this.#sendOnce({
        ...body,
        id: newPacketId()
      });
      if (status !== "try_again") return status;
      this.#log?.debug(`[sail:${this.game}] try_again \u2014 retry ${attempt + 1}/${this.#maxRetries} in ${this.#retryDelayMs}ms`);
      if (attempt < this.#maxRetries) await delay(this.#retryDelayMs);
    }
    return status;
  }
  async #sendOnce(packet) {
    try {
      await writeAll(this.#conn, encodePacket(packet));
    } catch (err) {
      this.#log?.warn(`[sail:${this.game}] write failed: ${err instanceof Error ? err.message : String(err)}`);
      this.close();
      return "failure";
    }
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(packet.id);
        resolve("timeout");
      }, this.#timeoutMs);
      this.#pending.set(packet.id, {
        resolve,
        timer
      });
    });
  }
  async #readLoop() {
    const buf = new Uint8Array(4096);
    while (!this.#closed) {
      let count;
      try {
        count = await this.#conn.read(buf);
      } catch {
        break;
      }
      if (count === null) break;
      for (const body of this.#framer.push(buf.subarray(0, count))) {
        this.#handle(body);
      }
    }
    this.close();
  }
  #handle(body) {
    const packet = parseIncoming(body);
    if (!packet) {
      this.#log?.debug(`[sail:${this.game}] ignoring malformed packet`);
      return;
    }
    if (packet.type === "result") {
      const pending = this.#pending.get(packet.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.#pending.delete(packet.id);
      pending.resolve(packet.status);
      return;
    }
    try {
      this.#onHook?.(packet.hook);
    } catch (err) {
      this.#log?.error(`[sail:${this.game}] hook handler threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  /** Close the connection and fail everything in flight. Idempotent. */
  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve("failure");
    }
    this.#pending.clear();
    try {
      this.#conn.close();
    } catch {
    }
    this.#onClose?.();
  }
};
async function writeAll(conn, data) {
  let offset = 0;
  while (offset < data.length) {
    const written = await conn.write(data.subarray(offset));
    if (written <= 0) throw new Error("connection refused the write");
    offset += written;
  }
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/server.ts
var SailServer = class {
  game;
  #deps;
  #listener;
  #clients = /* @__PURE__ */ new Set();
  #error = null;
  #stopped = false;
  constructor(deps) {
    this.#deps = deps;
    this.game = deps.game;
  }
  /** True once a game has connected. */
  get connected() {
    return this.#clients.size > 0;
  }
  get clients() {
    return [
      ...this.#clients
    ];
  }
  /** The port actually bound (resolves port 0), or the requested one. */
  get port() {
    const addr = this.#listener?.addr;
    return addr && addr.transport === "tcp" ? addr.port : this.#deps.port;
  }
  /** Why the listener isn't up (e.g. the port is taken), or null. */
  get error() {
    return this.#error;
  }
  get listening() {
    return this.#listener !== void 0;
  }
  /**
   * Start listening. A bind failure (port in use) is recorded and logged rather
   * than thrown — one game's port conflict shouldn't take the plugin down.
   */
  start() {
    if (this.#listener) return;
    this.#stopped = false;
    try {
      this.#listener = Deno.listen({
        port: this.#deps.port,
        hostname: "127.0.0.1"
      });
      this.#error = null;
      this.#deps.log?.info(`[sail:${this.game}] listening on 127.0.0.1:${this.port}`);
    } catch (err) {
      this.#error = err instanceof Error ? err.message : String(err);
      this.#deps.log?.error(`[sail:${this.game}] could not listen on port ${this.#deps.port}: ${this.#error}`);
      return;
    }
    void this.#acceptLoop(this.#listener);
  }
  async #acceptLoop(listener) {
    try {
      for await (const conn of listener) {
        if (this.#stopped) {
          try {
            conn.close();
          } catch {
          }
          return;
        }
        this.#adopt(conn);
      }
    } catch {
    }
  }
  #adopt(conn) {
    const client = new SailClient({
      conn,
      game: this.game,
      log: this.#deps.log,
      ...this.#deps.clientOptions,
      onHook: (hook) => this.#deps.onHook?.(this.game, hook),
      onClose: () => {
        if (!this.#clients.delete(client)) return;
        this.#deps.log?.info(`[sail:${this.game}] game disconnected`);
        this.#deps.onDisconnect?.(client);
      }
    });
    this.#clients.add(client);
    this.#deps.log?.info(`[sail:${this.game}] game connected`);
    const hooks = this.#deps.autoSubscribe ?? (this.game === "2s2h" ? TS2H_DEFAULT_HOOKS : []);
    if (hooks.length > 0) void this.#subscribeAll(client, hooks);
    this.#deps.onConnect?.(client);
  }
  async #subscribeAll(client, hooks) {
    for (const hook of hooks) {
      if (client.closed) return;
      const status = await client.subscribe(hook);
      if (status !== "success") {
        this.#deps.log?.warn(`[sail:${this.game}] subscribe ${hook} \u2192 ${status}`);
      }
    }
  }
  /** Close the listener and every connection, freeing the port. */
  stop() {
    this.#stopped = true;
    const listener = this.#listener;
    this.#listener = void 0;
    try {
      listener?.close();
    } catch {
    }
    for (const client of [
      ...this.#clients
    ]) client.close();
    this.#clients.clear();
  }
};

// src/spawn.ts
var SPAWN_VERBS = [
  "spawn",
  "safespawn",
  "spawnfwd"
];
function parseActorId(raw) {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const n = /^0x/i.test(s) ? parseInt(s.slice(2), 16) : Number(s);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
function buildSpawnCommand(verb, actorId, params) {
  const v = SPAWN_VERBS.includes(verb) ? verb : "spawn";
  const extra = params.trim();
  return extra ? `${v} ${actorId} ${extra}` : `${v} ${actorId}`;
}
var SpawnConfirmer = class {
  #waiters = [];
  #setTimer;
  #clearTimer;
  constructor(timers) {
    this.#setTimer = timers?.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.#clearTimer = timers?.clearTimer ?? ((h) => clearTimeout(h));
  }
  get pending() {
    return this.#waiters.length;
  }
  /** Wait for an OnActorInit matching (game, actorId) within timeoutMs. */
  await(game, actorId, timeoutMs) {
    let done = false;
    let timer;
    const waiter = {
      game,
      actorId,
      settle: () => {
      }
    };
    const confirmed = new Promise((resolve) => {
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
    return {
      confirmed,
      cancel: () => waiter.settle(false)
    };
  }
  /** Feed a hook; an OnActorInit confirms the oldest matching waiter. */
  deliver(game, hook) {
    if (hook.type !== "OnActorInit") return;
    const actorId = Number(hook.actorId);
    if (!Number.isInteger(actorId)) return;
    const waiter = this.#waiters.find((w) => w.game === game && w.actorId === actorId);
    waiter?.settle(true);
  }
  /** Fail every in-flight wait (teardown). */
  cancelAll() {
    for (const waiter of [
      ...this.#waiters
    ]) waiter.settle(false);
  }
  #remove(waiter) {
    const idx = this.#waiters.indexOf(waiter);
    if (idx !== -1) this.#waiters.splice(idx, 1);
  }
};
var ok2 = (out) => ({
  ok: true,
  out
});
var fail2 = (error) => ({
  ok: false,
  error
});
function buildSpawnFunction(deps) {
  const { dispatch, confirmer: confirmer2 } = deps;
  const isConnected = (game) => dispatch.connected(game);
  const s2hSubs = /* @__PURE__ */ new Map();
  const acquire2s2h = async (actorId) => {
    const count = s2hSubs.get(actorId) ?? 0;
    s2hSubs.set(actorId, count + 1);
    if (count === 0) {
      await dispatch.send("2s2h", {
        type: "subscribe",
        eventName: "OnActorInit",
        eventIdFilter: actorId
      });
    }
  };
  const release2s2h = async (actorId) => {
    const count = (s2hSubs.get(actorId) ?? 1) - 1;
    if (count <= 0) {
      s2hSubs.delete(actorId);
      await dispatch.send("2s2h", {
        type: "unsubscribe",
        eventName: "OnActorInit",
        eventIdFilter: actorId
      });
    } else {
      s2hSubs.set(actorId, count);
    }
  };
  async function spawnOne(game, actorId, command) {
    if (!deps.confirmEnabled()) {
      const status = await dispatch.send(game, {
        type: "command",
        command
      });
      return status === "success";
    }
    if (game === "2s2h") await acquire2s2h(actorId);
    try {
      const wait = confirmer2.await(game, actorId, deps.windowMs());
      const status = await dispatch.send(game, {
        type: "command",
        command
      });
      if (status !== "success") {
        wait.cancel();
        return false;
      }
      return await wait.confirmed;
    } finally {
      if (game === "2s2h") await release2s2h(actorId);
    }
  }
  return {
    id: "spawn",
    name: "Spawn an actor",
    description: "Spawn an actor by id and confirm it appeared (via OnActorInit) before charging. No confirmation \u2192 the viewer is refunded.",
    requires: {
      account: "none"
    },
    params: [
      targetParam(),
      {
        key: "actorId",
        label: "Actor id (decimal or 0x-hex)",
        type: "string",
        required: true
      },
      {
        key: "verb",
        label: "Spawn command",
        type: "select",
        options: [
          ...SPAWN_VERBS
        ],
        default: "spawn"
      },
      {
        key: "params",
        label: "Extra arguments",
        type: "string"
      }
    ],
    run: async (ctx) => {
      const actorId = parseActorId(ctx.params.actorId);
      if (actorId === null) {
        return fail2(`"${ctx.params.actorId}" is not an actor id`);
      }
      const command = buildSpawnCommand(ctx.params.verb ?? "spawn", actorId, ctx.params.params ?? "");
      const target = readTarget(ctx.params.target);
      const games = liveGames(target, isConnected);
      if (games.length === 0) return fail2(describeOffline(target));
      const results = await Promise.all(games.map((game) => spawnOne(game, actorId, command)));
      if (!results.every(Boolean)) {
        return fail2(deps.confirmEnabled() ? `spawn not confirmed within ${deps.windowMs()}ms` : "the spawn wasn't accepted");
      }
      return ok2({
        actorId,
        games: games.join(","),
        confirmed: games.length
      });
    }
  };
}

// mod.ts
var DEFAULT_SOH_PORT = 43384;
var DEFAULT_S2H_PORT = 43385;
var DEFAULT_CONFIRM_WINDOW_MS = 1500;
var servers = /* @__PURE__ */ new Map();
var confirmer;
function stopAll() {
  for (const server of servers.values()) server.stop();
  servers.clear();
}
var plugin = definePlugin({
  id: "sail",
  name: "Sail Game Control",
  version: "0.2.0",
  update: "github:stoatmagote/commander-plugin-sail",
  apiVersion: 1,
  setup(ctx) {
    ctx.settings.define([
      {
        key: "soh_port",
        label: "Ship of Harkinian port",
        type: "number",
        default: DEFAULT_SOH_PORT,
        description: "The port SoH's Sail connects to. Must match the game's setting."
      },
      {
        key: "s2h_port",
        label: "2 Ship 2 Harkinian port",
        type: "number",
        default: DEFAULT_S2H_PORT,
        description: "The port 2S2H's Sail connects to. Must match the game's setting."
      },
      {
        key: "spawn_confirm",
        label: "Confirm spawns",
        type: "boolean",
        default: true,
        description: "Wait for the game to confirm a spawn (OnActorInit) before charging. Off = charge as soon as the command is accepted."
      },
      {
        key: "spawn_confirm_window_ms",
        label: "Spawn confirm window (ms)",
        type: "number",
        default: DEFAULT_CONFIRM_WINDOW_MS,
        description: "How long to wait for a spawn's OnActorInit before refunding."
      }
    ]);
    const port = (key, fallback) => {
      const raw = Number(ctx.settings.get(key));
      return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : fallback;
    };
    const startAll = () => {
      stopAll();
      servers.set("soh", makeServer(ctx, "soh", port("soh_port", DEFAULT_SOH_PORT)));
      servers.set("2s2h", makeServer(ctx, "2s2h", port("s2h_port", DEFAULT_S2H_PORT)));
      for (const server of servers.values()) server.start();
    };
    confirmer = new SpawnConfirmer();
    startAll();
    const dispatch = new ServerDispatch(servers);
    for (const spec of buildSailFunctions({
      dispatch
    })) {
      ctx.functions.register(spec);
    }
    ctx.functions.register(buildSpawnFunction({
      dispatch,
      confirmer,
      confirmEnabled: () => ctx.settings.get("spawn_confirm") === true,
      windowMs: () => {
        const raw = Number(ctx.settings.get("spawn_confirm_window_ms"));
        return raw > 0 ? raw : DEFAULT_CONFIRM_WINDOW_MS;
      }
    }));
    ctx.settings.onChange((key) => {
      if (key === "soh_port" || key === "s2h_port") {
        ctx.log.info("port changed \u2014 restarting the Sail listeners");
        startAll();
      }
    });
    ctx.commands.register({
      trigger: "sail",
      usableBy: "streamer",
      run: (inv) => reportStatus(ctx, inv)
    });
  },
  teardown() {
    stopAll();
    confirmer?.cancelAll();
    confirmer = void 0;
  }
});
var mod_default = plugin;
function makeServer(ctx, game, port) {
  return new SailServer({
    game,
    port,
    log: ctx.log,
    onHook: (g, hook) => {
      confirmer?.deliver(g, hook);
      ctx.log.debug(`[sail:${g}] ${describeHook(hook)}`);
    }
  });
}
function describeHook(hook) {
  const fields = Object.entries(hook).filter(([key]) => key !== "type").map(([key, value]) => `${key}=${String(value)}`).join(" ");
  return fields ? `${hook.type} ${fields}` : hook.type;
}
function reportStatus(ctx, inv) {
  const label = {
    soh: "SoH",
    "2s2h": "2S2H"
  };
  const parts = [
    ...servers.values()
  ].map((server) => {
    if (server.error) return `${label[server.game]}: port error`;
    if (!server.listening) return `${label[server.game]}: off`;
    return `${label[server.game]}: ${server.connected ? "connected" : `waiting on ${server.port}`}`;
  });
  const text = parts.length > 0 ? parts.join(" | ") : "Sail isn't listening.";
  return ctx.chat.send(text, {
    replyTo: inv.messageId
  }).then(() => {
  }).catch(() => {
  });
}
export {
  mod_default as default
};
