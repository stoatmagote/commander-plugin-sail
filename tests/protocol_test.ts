// tests/protocol_test.ts — Sail wire framing and packet parsing (COM-36).
//
// TCP gives no message boundaries, so the framer is the part most likely to
// break in the field: a read can carry half a packet, several packets, or both.

import { assert, assertEquals } from "@std/assert";
import {
  encodePacket,
  PacketFramer,
  parseIncoming,
  TS2H_DEFAULT_HOOKS,
} from "../src/protocol.ts";

const enc = new TextEncoder();
/** Encode packet bodies into one NUL-delimited chunk. */
const chunk = (...bodies: string[]) => enc.encode(bodies.join("\0") + "\0");

Deno.test("framer: one packet in one read", () => {
  const f = new PacketFramer();
  assertEquals(f.push(chunk('{"a":1}')), ['{"a":1}']);
  assertEquals(f.pending, 0);
});

Deno.test("framer: a packet split across reads is reassembled", () => {
  const f = new PacketFramer();
  assertEquals(f.push(enc.encode('{"hel')), [], "no terminator yet");
  assert(f.pending > 0, "the partial packet is buffered");
  assertEquals(f.push(enc.encode('lo":1}\0')), ['{"hello":1}']);
  assertEquals(f.pending, 0);
});

Deno.test("framer: several packets in one read all come out", () => {
  const f = new PacketFramer();
  assertEquals(f.push(chunk("a", "b", "c")), ["a", "b", "c"]);
});

Deno.test("framer: a trailing partial is kept for the next read", () => {
  const f = new PacketFramer();
  assertEquals(f.push(enc.encode("one\0two\0thr")), ["one", "two"]);
  assert(f.pending > 0);
  assertEquals(f.push(enc.encode("ee\0")), ["three"]);
});

Deno.test("framer: empty packets (back-to-back NULs) are skipped", () => {
  const f = new PacketFramer();
  assertEquals(f.push(enc.encode("\0\0x\0")), ["x"]);
});

Deno.test("framer: a byte-at-a-time stream still reassembles", () => {
  const f = new PacketFramer();
  const bytes = chunk('{"id":"1"}');
  const out: string[] = [];
  for (const b of bytes) out.push(...f.push(new Uint8Array([b])));
  assertEquals(out, ['{"id":"1"}']);
});

Deno.test("encodePacket is JSON terminated by NUL", () => {
  const bytes = encodePacket({ id: "x", type: "command", command: "spawn 1" });
  assertEquals(bytes[bytes.length - 1], 0, "NUL terminated");
  const body = new TextDecoder().decode(bytes.subarray(0, bytes.length - 1));
  assertEquals(JSON.parse(body), {
    id: "x",
    type: "command",
    command: "spawn 1",
  });
});

Deno.test("parseIncoming accepts results and hooks", () => {
  assertEquals(parseIncoming('{"id":"7","type":"result","status":"success"}'), {
    id: "7",
    type: "result",
    status: "success",
  });
  const hook = parseIncoming(
    '{"type":"hook","hook":{"type":"OnActorInit","actorId":3,"params":0}}',
  );
  assert(hook?.type === "hook");
  if (hook?.type === "hook") {
    assertEquals(hook.hook.type, "OnActorInit");
    assertEquals(hook.hook.actorId, 3);
  }
});

Deno.test("parseIncoming rejects anything malformed", () => {
  assertEquals(parseIncoming("not json"), null);
  assertEquals(parseIncoming("[]"), null);
  assertEquals(parseIncoming('{"type":"result","status":"success"}'), null);
  assertEquals(
    parseIncoming('{"id":"1","type":"result","status":"weird"}'),
    null,
    "unknown status",
  );
  assertEquals(
    parseIncoming('{"type":"hook","hook":{}}'),
    null,
    "hook needs a type",
  );
  assertEquals(parseIncoming('{"type":"mystery"}'), null);
});

Deno.test("2S2H default hooks exclude the chatty OnActorInit", () => {
  assert(!TS2H_DEFAULT_HOOKS.includes("OnActorInit"));
  assert(TS2H_DEFAULT_HOOKS.includes("OnSceneInit"));
  assertEquals(TS2H_DEFAULT_HOOKS.length, 6);
});
