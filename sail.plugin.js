// ../Commander/plugin-api/mod.ts
function definePlugin(plugin2) {
  return plugin2;
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

// mod.ts
var DEFAULT_SOH_PORT = 43384;
var DEFAULT_S2H_PORT = 43385;
var servers = [];
function stopAll() {
  for (const server of servers) server.stop();
  servers = [];
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
      }
    ]);
    const port = (key, fallback) => {
      const raw = Number(ctx.settings.get(key));
      return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : fallback;
    };
    const startAll = () => {
      stopAll();
      servers = [
        makeServer(ctx, "soh", port("soh_port", DEFAULT_SOH_PORT)),
        makeServer(ctx, "2s2h", port("s2h_port", DEFAULT_S2H_PORT))
      ];
      for (const server of servers) server.start();
    };
    startAll();
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
  }
});
var mod_default = plugin;
function makeServer(ctx, game, port) {
  return new SailServer({
    game,
    port,
    log: ctx.log,
    onHook: (g, hook) => ctx.log.debug(`[sail:${g}] ${describeHook(hook)}`)
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
  const parts = servers.map((server) => {
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
