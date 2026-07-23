// src/client.ts — one connected game (COM-36).
//
// Wraps the TCP connection a game opened to us: reads the framed packet stream,
// correlates `result` replies to the packets we sent, and surfaces pushed hooks.
//
// Failure semantics (matching the legacy client, with the rough edges fixed):
//   - a reply of "try_again" is retried after a short delay, up to a cap
//     (the legacy client retried forever, which could hang a command);
//   - no reply within the timeout resolves "timeout";
//   - a write error or the game disconnecting resolves every in-flight packet
//     "failure" immediately, rather than leaving callers waiting for a timeout.
//
// Nothing here throws at the caller: every send resolves to a ResultStatus.

import {
  encodePacket,
  newPacketId,
  type OutgoingBody,
  type OutgoingPacket,
  PacketFramer,
  parseIncoming,
  type ResultStatus,
  type SailGame,
  type SailHook,
} from "./protocol.ts";

/** The slice of ctx.log this module uses. */
export interface SailLog {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface SailClientOptions {
  /** How long to wait for a `result` before giving up. Default 5000ms. */
  timeoutMs?: number;
  /** How long to wait before re-sending after "try_again". Default 500ms. */
  retryDelayMs?: number;
  /** How many "try_again" retries before giving up. Default 5. */
  maxRetries?: number;
}

export interface SailClientDeps extends SailClientOptions {
  conn: Deno.Conn;
  game: SailGame;
  onHook?: (hook: SailHook) => void;
  onClose?: () => void;
  log?: SailLog;
}

interface Pending {
  resolve: (status: ResultStatus) => void;
  timer: ReturnType<typeof setTimeout>;
}

let nextClientId = 1;

export class SailClient {
  readonly game: SailGame;
  readonly id: number;

  #conn: Deno.Conn;
  #log?: SailLog;
  #onHook?: (hook: SailHook) => void;
  #onClose?: () => void;
  #framer = new PacketFramer();
  #pending = new Map<string, Pending>();
  #closed = false;

  #timeoutMs: number;
  #retryDelayMs: number;
  #maxRetries: number;

  constructor(deps: SailClientDeps) {
    this.#conn = deps.conn;
    this.game = deps.game;
    this.id = nextClientId++;
    this.#log = deps.log;
    this.#onHook = deps.onHook;
    this.#onClose = deps.onClose;
    this.#timeoutMs = deps.timeoutMs ?? 5000;
    this.#retryDelayMs = deps.retryDelayMs ?? 500;
    this.#maxRetries = deps.maxRetries ?? 5;
    void this.#readLoop();
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Send a console command (the channel both games support). */
  command(command: string): Promise<ResultStatus> {
    return this.send({ type: "command", command });
  }

  /** Send an effect packet (apply/remove/command/teleport shapes). */
  effect(effect: Record<string, unknown>): Promise<ResultStatus> {
    return this.send({ type: "effect", effect });
  }

  /** Subscribe to a hook (2S2H emits nothing until you do). */
  subscribe(eventName: string, eventIdFilter?: number): Promise<ResultStatus> {
    const body: OutgoingBody = { type: "subscribe", eventName };
    if (eventIdFilter !== undefined) body.eventIdFilter = eventIdFilter;
    return this.send(body);
  }

  /** Stop receiving a hook previously subscribed to. */
  unsubscribe(
    eventName: string,
    eventIdFilter?: number,
  ): Promise<ResultStatus> {
    const body: OutgoingBody = { type: "unsubscribe", eventName };
    if (eventIdFilter !== undefined) body.eventIdFilter = eventIdFilter;
    return this.send(body);
  }

  /**
   * Send a packet and resolve with the game's verdict, retrying "try_again".
   * Never rejects.
   */
  async send(body: OutgoingBody): Promise<ResultStatus> {
    let status: ResultStatus = "failure";
    for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
      if (this.#closed) return "failure";
      status = await this.#sendOnce({ ...body, id: newPacketId() });
      if (status !== "try_again") return status;
      this.#log?.debug(
        `[sail:${this.game}] try_again — retry ${
          attempt + 1
        }/${this.#maxRetries} in ${this.#retryDelayMs}ms`,
      );
      if (attempt < this.#maxRetries) await delay(this.#retryDelayMs);
    }
    return status;
  }

  async #sendOnce(packet: OutgoingPacket): Promise<ResultStatus> {
    try {
      await writeAll(this.#conn, encodePacket(packet));
    } catch (err) {
      this.#log?.warn(
        `[sail:${this.game}] write failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.close();
      return "failure";
    }

    return await new Promise<ResultStatus>((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(packet.id);
        resolve("timeout");
      }, this.#timeoutMs);
      this.#pending.set(packet.id, { resolve, timer });
    });
  }

  async #readLoop(): Promise<void> {
    const buf = new Uint8Array(4096);
    while (!this.#closed) {
      let count: number | null;
      try {
        count = await this.#conn.read(buf);
      } catch {
        break; // connection reset / closed under us
      }
      if (count === null) break; // clean EOF
      for (const body of this.#framer.push(buf.subarray(0, count))) {
        this.#handle(body);
      }
    }
    this.close();
  }

  #handle(body: string): void {
    const packet = parseIncoming(body);
    if (!packet) {
      this.#log?.debug(`[sail:${this.game}] ignoring malformed packet`);
      return;
    }
    if (packet.type === "result") {
      const pending = this.#pending.get(packet.id);
      if (!pending) return; // already timed out, or not ours
      clearTimeout(pending.timer);
      this.#pending.delete(packet.id);
      pending.resolve(packet.status);
      return;
    }
    try {
      this.#onHook?.(packet.hook);
    } catch (err) {
      this.#log?.error(
        `[sail:${this.game}] hook handler threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Close the connection and fail everything in flight. Idempotent. */
  close(): void {
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
      // already closed
    }
    this.#onClose?.();
  }
}

/** Deno.Conn.write may write partially; loop until it's all out. */
async function writeAll(conn: Deno.Conn, data: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < data.length) {
    const written = await conn.write(data.subarray(offset));
    if (written <= 0) throw new Error("connection refused the write");
    offset += written;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
