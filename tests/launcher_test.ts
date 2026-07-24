// tests/launcher_test.ts — the game launcher (run SoH / 2S2H buttons).

import { assert, assertEquals } from "@std/assert";
import { dirOf, launchGame, type LaunchHost } from "../src/launcher.ts";

function fakeHost(opts: { missing?: boolean; spawnThrows?: boolean } = {}) {
  const spawns: { path: string; cwd: string }[] = [];
  const host: LaunchHost = {
    stat: (path) => {
      if (opts.missing) throw new Error("ENOENT: " + path);
    },
    spawn: (path, cwd) => {
      if (opts.spawnThrows) throw new Error("spawn failed");
      spawns.push({ path, cwd });
    },
  };
  return { host, spawns };
}

Deno.test("dirOf handles Windows and POSIX separators", () => {
  assertEquals(dirOf("C:\\Games\\SoH\\soh.exe"), "C:/Games/SoH");
  assertEquals(dirOf("/opt/soh/soh"), "/opt/soh");
  assertEquals(dirOf("soh.exe"), ".");
});

Deno.test("launches with the game's own folder as cwd", () => {
  const f = fakeHost();
  const res = launchGame("C:\\Games\\SoH\\soh.exe", f.host);
  assertEquals(res.ok, true);
  assertEquals(f.spawns, [{
    path: "C:\\Games\\SoH\\soh.exe",
    cwd: "C:/Games/SoH",
  }]);
});

Deno.test("an empty path is a clear error, nothing spawned", () => {
  const f = fakeHost();
  const res = launchGame("   ", f.host);
  assertEquals(res.ok, false);
  assert(res.error?.includes("no executable path"));
  assertEquals(f.spawns.length, 0);
});

Deno.test("a missing executable reports not found", () => {
  const f = fakeHost({ missing: true });
  const res = launchGame("C:\\nope\\soh.exe", f.host);
  assertEquals(res.ok, false);
  assert(res.error?.includes("not found"));
  assertEquals(f.spawns.length, 0);
});

Deno.test("a spawn failure is caught and reported", () => {
  const f = fakeHost({ spawnThrows: true });
  const res = launchGame("C:\\Games\\SoH\\soh.exe", f.host);
  assertEquals(res.ok, false);
  assert(res.error?.includes("spawn failed"));
});
