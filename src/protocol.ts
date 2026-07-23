// src/protocol.ts — the Sail wire protocol (COM-36).
//
// SoH and 2S2H both speak Sail: newline-free JSON packets terminated by a NUL
// byte, over a TCP connection the *game* opens to us. Verified against the
// legacy reference (SoH Sail/sail-main/{SohClient,types,types_2s2h}.ts):
//
//   outgoing  { id, type: "command" | "effect" | "subscribe" | "unsubscribe", … }
//   incoming  { id, type: "result", status }        ← correlated to an outgoing id
//             { type: "hook", hook: { type, … } }   ← pushed by the game
//
// Differences between the games that matter here:
//   - SoH pushes hooks automatically; 2S2H emits nothing until you `subscribe`.
//   - 2S2H stubs "apply"/"remove" effects (they return success without acting);
//     only `command` and `teleport` effects do anything there.
//
// This module is pure — no I/O — so the framing unit-tests on its own.

/** Which game a connection belongs to. */
export type SailGame = "soh" | "2s2h";

/** The reply status for a correlated packet. */
export type ResultStatus = "success" | "failure" | "try_again" | "timeout";

/** A hook pushed by the game. `type` names the event; the rest varies by hook. */
export interface SailHook {
  type: string;
  [key: string]: unknown;
}

export interface ResultPacket {
  id: string;
  type: "result";
  status: ResultStatus;
}

export interface HookPacket {
  id?: string;
  type: "hook";
  hook: SailHook;
}

export type IncomingPacket = ResultPacket | HookPacket;

/**
 * An outgoing packet before the client stamps an id on it. Declared directly
 * rather than as Omit<OutgoingPacket, "id">: Omit collapses a type carrying an
 * index signature, which would drop the required `type` field.
 */
export interface OutgoingBody {
  type: string;
  [key: string]: unknown;
}

/** Anything we send. `id` is added by the client for correlation. */
export interface OutgoingPacket extends OutgoingBody {
  id: string;
}

/**
 * Hooks 2S2H is subscribed to on connect. `OnActorInit` is deliberately absent
 * — it fires for every actor and floods the socket. Spawn confirmation
 * (COM-45) should instead subscribe to it with an `eventIdFilter` for the one
 * actor it's waiting on, then unsubscribe.
 */
export const TS2H_DEFAULT_HOOKS: readonly string[] = [
  "OnSceneInit",
  "OnItemGive",
  "OnFlagSet",
  "OnFlagUnset",
  "OnSceneFlagSet",
  "OnSceneFlagUnset",
];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Serialize a packet with its NUL terminator. */
export function encodePacket(packet: OutgoingPacket): Uint8Array {
  return encoder.encode(JSON.stringify(packet) + "\0");
}

/** Parse one packet body. Returns null for malformed or unrecognized packets. */
export function parseIncoming(text: string): IncomingPacket | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  if (obj.type === "result" && typeof obj.id === "string") {
    const status = obj.status;
    if (
      status === "success" || status === "failure" ||
      status === "try_again" || status === "timeout"
    ) {
      return { id: obj.id, type: "result", status };
    }
    return null;
  }

  if (obj.type === "hook") {
    const hook = obj.hook as Record<string, unknown> | undefined;
    if (hook && typeof hook === "object" && typeof hook.type === "string") {
      return { type: "hook", hook: hook as SailHook };
    }
  }
  return null;
}

/** A fresh correlation id. */
export function newPacketId(): string {
  return crypto.randomUUID();
}

/**
 * Reassembles the NUL-delimited packet stream. TCP gives no message boundaries,
 * so a read can carry half a packet, several packets, or both — push() buffers
 * the remainder and returns only the complete packet bodies.
 */
export class PacketFramer {
  #buffer = new Uint8Array(0);

  push(chunk: Uint8Array): string[] {
    const merged = new Uint8Array(this.#buffer.length + chunk.length);
    merged.set(this.#buffer);
    merged.set(chunk, this.#buffer.length);
    this.#buffer = merged;

    const packets: string[] = [];
    let start = 0;
    for (let i = 0; i < this.#buffer.length; i++) {
      if (this.#buffer[i] !== 0) continue;
      const body = this.#buffer.subarray(start, i);
      if (body.length > 0) packets.push(decoder.decode(body));
      start = i + 1;
    }
    // slice() copies, so a huge read isn't retained by a small leftover.
    this.#buffer = this.#buffer.slice(start);
    return packets;
  }

  /** Bytes buffered awaiting a terminator (diagnostics / tests). */
  get pending(): number {
    return this.#buffer.length;
  }
}
