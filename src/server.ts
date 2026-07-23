// src/server.ts — the TCP listener a game dials into (COM-36).
//
// Sail is backwards from most integrations: *the game* opens the connection, so
// the plugin listens (SoH 43384, 2S2H 43385 by default). One server per game;
// each accepted connection becomes a SailClient.
//
// stop() must free the port — Commander disables plugins at runtime, and a
// re-enable has to be able to listen again without restarting the app.

import { SailClient, type SailClientOptions, type SailLog } from "./client.ts";
import {
  type SailGame,
  type SailHook,
  TS2H_DEFAULT_HOOKS,
} from "./protocol.ts";

export interface SailServerDeps {
  game: SailGame;
  /** Port to listen on. 0 asks the OS for a free one (tests). */
  port: number;
  onConnect?: (client: SailClient) => void;
  onDisconnect?: (client: SailClient) => void;
  onHook?: (game: SailGame, hook: SailHook) => void;
  /** Hooks to subscribe to on connect. Defaults to 2S2H's set for 2s2h. */
  autoSubscribe?: readonly string[];
  log?: SailLog;
  clientOptions?: SailClientOptions;
}

export class SailServer {
  readonly game: SailGame;

  #deps: SailServerDeps;
  #listener?: Deno.Listener;
  #clients = new Set<SailClient>();
  #error: string | null = null;
  #stopped = false;

  constructor(deps: SailServerDeps) {
    this.#deps = deps;
    this.game = deps.game;
  }

  /** True once a game has connected. */
  get connected(): boolean {
    return this.#clients.size > 0;
  }

  get clients(): SailClient[] {
    return [...this.#clients];
  }

  /** The port actually bound (resolves port 0), or the requested one. */
  get port(): number {
    const addr = this.#listener?.addr;
    return addr && addr.transport === "tcp" ? addr.port : this.#deps.port;
  }

  /** Why the listener isn't up (e.g. the port is taken), or null. */
  get error(): string | null {
    return this.#error;
  }

  get listening(): boolean {
    return this.#listener !== undefined;
  }

  /**
   * Start listening. A bind failure (port in use) is recorded and logged rather
   * than thrown — one game's port conflict shouldn't take the plugin down.
   */
  start(): void {
    if (this.#listener) return;
    this.#stopped = false;
    try {
      this.#listener = Deno.listen({
        port: this.#deps.port,
        hostname: "127.0.0.1",
      });
      this.#error = null;
      this.#deps.log?.info(
        `[sail:${this.game}] listening on 127.0.0.1:${this.port}`,
      );
    } catch (err) {
      this.#error = err instanceof Error ? err.message : String(err);
      this.#deps.log?.error(
        `[sail:${this.game}] could not listen on port ${this.#deps.port}: ${this.#error}`,
      );
      return;
    }
    void this.#acceptLoop(this.#listener);
  }

  async #acceptLoop(listener: Deno.Listener): Promise<void> {
    try {
      for await (const conn of listener) {
        if (this.#stopped) {
          try {
            conn.close();
          } catch { /* ignore */ }
          return;
        }
        this.#adopt(conn);
      }
    } catch {
      // listener closed (stop()) or errored — nothing to do
    }
  }

  #adopt(conn: Deno.Conn): void {
    const client: SailClient = new SailClient({
      conn,
      game: this.game,
      log: this.#deps.log,
      ...this.#deps.clientOptions,
      onHook: (hook) => this.#deps.onHook?.(this.game, hook),
      onClose: () => {
        if (!this.#clients.delete(client)) return;
        this.#deps.log?.info(`[sail:${this.game}] game disconnected`);
        this.#deps.onDisconnect?.(client);
      },
    });
    this.#clients.add(client);
    this.#deps.log?.info(`[sail:${this.game}] game connected`);

    // 2S2H emits no hooks until subscribed. Done in the background so a silent
    // game can't stall the accept loop.
    const hooks = this.#deps.autoSubscribe ??
      (this.game === "2s2h" ? TS2H_DEFAULT_HOOKS : []);
    if (hooks.length > 0) void this.#subscribeAll(client, hooks);

    this.#deps.onConnect?.(client);
  }

  async #subscribeAll(
    client: SailClient,
    hooks: readonly string[],
  ): Promise<void> {
    for (const hook of hooks) {
      if (client.closed) return;
      const status = await client.subscribe(hook);
      if (status !== "success") {
        this.#deps.log?.warn(
          `[sail:${this.game}] subscribe ${hook} → ${status}`,
        );
      }
    }
  }

  /** Close the listener and every connection, freeing the port. */
  stop(): void {
    this.#stopped = true;
    const listener = this.#listener;
    this.#listener = undefined;
    try {
      listener?.close();
    } catch { /* already closed */ }
    for (const client of [...this.#clients]) client.close();
    this.#clients.clear();
  }
}
