// tests/server_test.ts — the Sail listener + client over real sockets (COM-36).
//
// A FakeGame stands in for SoH/2S2H: it dials into the plugin's listener the
// way the real games do, speaks the same NUL-delimited JSON, and lets each test
// script the replies. This covers the acceptance criteria that don't need the
// games themselves — round-trip, try_again retry, mid-command disconnect, and
// that teardown frees the port.

import { assert, assertEquals } from "@std/assert";
import {
  type OutgoingPacket,
  PacketFramer,
  type SailHook,
} from "../src/protocol.ts";
import { SailServer } from "../src/server.ts";

const enc = new TextEncoder();
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait for a condition, polling briefly. Throws if it never becomes true. */
async function waitUntil(
  check: () => boolean,
  what: string,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(5);
  }
  throw new Error(`timed out waiting for: ${what}`);
}

/** A stand-in for a game: connects to the plugin and speaks Sail. */
class FakeGame {
  #conn: Deno.Conn;
  #framer = new PacketFramer();
  #queue: OutgoingPacket[] = [];
  #waiters: ((p: OutgoingPacket) => void)[] = [];
  #closed = false;
  /** Every packet the plugin sent us, in order. */
  readonly all: OutgoingPacket[] = [];
  /** When set, auto-reply to each packet with this status. */
  autoReply: "success" | "failure" | null = null;

  private constructor(conn: Deno.Conn) {
    this.#conn = conn;
    void this.#read();
  }

  static async connect(port: number): Promise<FakeGame> {
    return new FakeGame(
      await Deno.connect({ port, hostname: "127.0.0.1" }),
    );
  }

  async #read(): Promise<void> {
    const buf = new Uint8Array(4096);
    while (!this.#closed) {
      let n: number | null;
      try {
        n = await this.#conn.read(buf);
      } catch {
        break;
      }
      if (n === null) break;
      for (const body of this.#framer.push(buf.subarray(0, n))) {
        const packet = JSON.parse(body) as OutgoingPacket;
        this.all.push(packet);
        if (this.autoReply) this.reply(packet.id, this.autoReply);
        const waiter = this.#waiters.shift();
        if (waiter) waiter(packet);
        else this.#queue.push(packet);
      }
    }
  }

  /** The next packet the plugin sends (or one already buffered). */
  next(): Promise<OutgoingPacket> {
    const queued = this.#queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  reply(id: string, status: string): void {
    this.#write(JSON.stringify({ id, type: "result", status }));
  }

  pushHook(hook: SailHook): void {
    this.#write(JSON.stringify({ type: "hook", hook }));
  }

  /** Send a body raw, so tests can exercise chunking. */
  writeRaw(bytes: Uint8Array): void {
    void this.#conn.write(bytes).catch(() => {});
  }

  #write(body: string): void {
    void this.#conn.write(enc.encode(body + "\0")).catch(() => {});
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#conn.close();
    } catch { /* already gone */ }
  }
}

/** Start a listener on an OS-assigned port with fast timeouts. */
function startServer(
  opts: Partial<ConstructorParameters<typeof SailServer>[0]> = {},
): SailServer {
  const server = new SailServer({
    game: "soh",
    port: 0,
    clientOptions: { timeoutMs: 150, retryDelayMs: 10, maxRetries: 3 },
    ...opts,
  });
  server.start();
  return server;
}

Deno.test("AC: a game connects and a console command round-trips", async () => {
  const server = startServer();
  const game = await FakeGame.connect(server.port);
  await waitUntil(() => server.connected, "the server sees the game");

  const client = server.clients[0];
  const pending = client.command("spawn 0x0018");

  const packet = await game.next();
  assertEquals(packet.type, "command");
  assertEquals(packet.command, "spawn 0x0018");
  assert(typeof packet.id === "string" && packet.id.length > 0, "has an id");

  game.reply(packet.id, "success");
  assertEquals(await pending, "success");

  game.close();
  server.stop();
  await delay(20);
});

Deno.test("a failure verdict comes back as failure (engine refunds)", async () => {
  const server = startServer();
  const game = await FakeGame.connect(server.port);
  await waitUntil(() => server.connected, "connected");

  const pending = server.clients[0].command("bad command");
  const packet = await game.next();
  game.reply(packet.id, "failure");
  assertEquals(await pending, "failure");

  game.close();
  server.stop();
  await delay(20);
});

Deno.test("AC: try_again is observably retried, then succeeds", async () => {
  const server = startServer();
  const game = await FakeGame.connect(server.port);
  await waitUntil(() => server.connected, "connected");

  const pending = server.clients[0].command("spawn 1");

  const first = await game.next();
  game.reply(first.id, "try_again");
  const second = await game.next();
  assert(second.id !== first.id, "the retry is a fresh packet");
  assertEquals(second.command, "spawn 1", "the same command is re-sent");
  game.reply(second.id, "success");

  assertEquals(await pending, "success");
  assertEquals(game.all.length, 2, "sent twice — the retry is observable");

  game.close();
  server.stop();
  await delay(20);
});

Deno.test("endless try_again gives up at the retry cap instead of hanging", async () => {
  const server = startServer();
  const game = await FakeGame.connect(server.port);
  await waitUntil(() => server.connected, "connected");

  game.autoReply = null;
  const pending = server.clients[0].command("nope");
  // Reply try_again to everything.
  void (async () => {
    for (let i = 0; i < 10; i++) {
      const p = await game.next();
      game.reply(p.id, "try_again");
    }
  })();

  assertEquals(await pending, "try_again", "resolves rather than looping");
  assertEquals(game.all.length, 4, "initial send + 3 retries (maxRetries: 3)");

  game.close();
  server.stop();
  await delay(20);
});

Deno.test("a silent game times out", async () => {
  const server = startServer();
  const game = await FakeGame.connect(server.port);
  await waitUntil(() => server.connected, "connected");

  const started = Date.now();
  const status = await server.clients[0].command("into the void");
  assertEquals(status, "timeout");
  assert(Date.now() - started >= 140, "waited for the timeout window");

  game.close();
  server.stop();
  await delay(20);
});

Deno.test("AC: disconnecting mid-command yields a clean failure", async () => {
  const server = startServer();
  const game = await FakeGame.connect(server.port);
  await waitUntil(() => server.connected, "connected");

  const pending = server.clients[0].command("spawn 2");
  await game.next(); // received, but the game dies before replying
  game.close();

  // Resolves "failure" immediately — not after the timeout.
  const started = Date.now();
  assertEquals(await pending, "failure");
  assert(Date.now() - started < 140, "didn't wait out the timeout");

  await waitUntil(() => !server.connected, "the server drops the client");
  server.stop();
  await delay(20);
});

Deno.test("hooks pushed by the game are delivered, split reads and all", async () => {
  const hooks: SailHook[] = [];
  const server = startServer({ onHook: (_g, h) => hooks.push(h) });
  const game = await FakeGame.connect(server.port);
  await waitUntil(() => server.connected, "connected");

  game.pushHook({ type: "OnActorInit", actorId: 24, params: 0 });
  await waitUntil(() => hooks.length === 1, "first hook");
  assertEquals(hooks[0].type, "OnActorInit");
  assertEquals(hooks[0].actorId, 24);

  // Same hook, delivered in two TCP reads.
  const body = JSON.stringify({
    type: "hook",
    hook: { type: "OnLoadGame", fileNum: 1 },
  });
  game.writeRaw(enc.encode(body.slice(0, 10)));
  await delay(20);
  game.writeRaw(enc.encode(body.slice(10) + "\0"));
  await waitUntil(() => hooks.length === 2, "reassembled hook");
  assertEquals(hooks[1].type, "OnLoadGame");

  game.close();
  server.stop();
  await delay(20);
});

Deno.test("2S2H is auto-subscribed to its hook set on connect", async () => {
  const server = startServer({ game: "2s2h" });
  const game = await FakeGame.connect(server.port);
  game.autoReply = "success";
  await waitUntil(() => server.connected, "connected");
  await waitUntil(() => game.all.length >= 6, "six subscribe packets");

  const names = game.all.map((p) => p.eventName);
  assert(game.all.every((p) => p.type === "subscribe"));
  assert(names.includes("OnSceneInit"), "subscribed to OnSceneInit");
  assert(names.includes("OnItemGive"));
  assert(!names.includes("OnActorInit"), "the chatty hook is opt-in");

  game.close();
  server.stop();
  await delay(20);
});

Deno.test("SoH is not auto-subscribed (it pushes hooks by default)", async () => {
  const server = startServer({ game: "soh" });
  const game = await FakeGame.connect(server.port);
  await waitUntil(() => server.connected, "connected");
  await delay(50);
  assertEquals(game.all.length, 0, "nothing sent on connect");

  game.close();
  server.stop();
  await delay(20);
});

Deno.test("AC: stop() frees the port, and re-starting works", async () => {
  const first = startServer();
  const port = first.port;
  const game = await FakeGame.connect(port);
  await waitUntil(() => first.connected, "connected");

  game.close();
  first.stop();
  await delay(50);

  // Re-binding the same port would throw AddrInUse if stop() leaked it.
  const second = new SailServer({ game: "soh", port });
  second.start();
  assertEquals(second.error, null, "re-listened on the same port");
  assert(second.listening);

  const game2 = await FakeGame.connect(port);
  await waitUntil(() => second.connected, "reconnected after restart");

  game2.close();
  second.stop();
  await delay(20);
});

Deno.test("a port already in use is recorded, not thrown", async () => {
  const holder = Deno.listen({ port: 0, hostname: "127.0.0.1" });
  const port = (holder.addr as Deno.NetAddr).port;

  const server = new SailServer({ game: "soh", port });
  server.start(); // must not throw
  assert(server.error !== null, "the bind failure is recorded");
  assertEquals(server.listening, false);

  holder.close();
  server.stop();
  await delay(20);
});

Deno.test("sends after the game is gone fail fast", async () => {
  const server = startServer();
  const game = await FakeGame.connect(server.port);
  await waitUntil(() => server.connected, "connected");
  const client = server.clients[0];

  game.close();
  await waitUntil(() => client.closed, "client noticed the disconnect");
  assertEquals(await client.command("too late"), "failure");

  server.stop();
  await delay(20);
});
