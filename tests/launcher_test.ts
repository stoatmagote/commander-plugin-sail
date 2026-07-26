// tests/launcher_test.ts — the game launcher (run SoH / 2S2H buttons).

import { assert, assertEquals } from "@std/assert";
import {
  buildPickerScript,
  type CommandRunner,
  detachedCommand,
  dirOf,
  launchGame,
  type LaunchHost,
  makeFilePicker,
} from "../src/launcher.ts";

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

// ---- Browse file picker ----

function fakeRunner(stdout: string, throws = false): {
  runner: CommandRunner;
  calls: { cmd: string; args: string[] }[];
} {
  const calls: { cmd: string; args: string[] }[] = [];
  return {
    calls,
    runner: {
      run: (cmd, args) => {
        calls.push({ cmd, args });
        if (throws) return Promise.reject(new Error("no powershell"));
        return Promise.resolve({ stdout });
      },
    },
  };
}

Deno.test("buildPickerScript shows an exe dialog and escapes the title", () => {
  const s = buildPickerScript("Select the Bob's game");
  assert(s.includes("OpenFileDialog"));
  assert(s.includes("*.exe"));
  assert(s.includes("Bob''s game"), "single quotes are doubled for PowerShell");
});

Deno.test("picker returns the chosen path, trimmed", async () => {
  const f = fakeRunner("C:\\Games\\SoH\\soh.exe\r\n");
  const path = await makeFilePicker(f.runner, "windows").pick("t");
  assertEquals(path, "C:\\Games\\SoH\\soh.exe");
  assertEquals(f.calls[0].cmd, "powershell");
  assert(f.calls[0].args.includes("-STA"));
});

Deno.test("picker returns null when the dialog is cancelled (empty output)", async () => {
  const f = fakeRunner("");
  assertEquals(await makeFilePicker(f.runner, "windows").pick("t"), null);
});

Deno.test("picker is a no-op off Windows, and swallows a runner failure", async () => {
  const off = fakeRunner("whatever");
  assertEquals(await makeFilePicker(off.runner, "linux").pick("t"), null);
  assertEquals(off.calls.length, 0, "nothing run off Windows");

  const broken = fakeRunner("", true);
  assertEquals(await makeFilePicker(broken.runner, "windows").pick("t"), null);
});

// ---- detached launch (COM-63) ----

Deno.test("on Windows the game is started detached, not as our child", () => {
  const { cmd, args } = detachedCommand(
    "C:/Games/2 Ship 2 Harkinian/2s2h.exe",
    "C:/Games/2 Ship 2 Harkinian",
    "windows",
  );
  // ShellExecute via Start-Process: the game gets its own console, so closing
  // Commander (or the terminal it was started from) can't take it down, and it
  // never sees our already-at-EOF stdin.
  assertEquals(cmd, "powershell");
  const script = args[args.length - 1];
  assert(script.startsWith("Start-Process -FilePath "), script);
  // Backslashes: `start`/ShellExecute mis-parse forward slashes.
  assert(
    script.includes(String.raw`'C:\Games\2 Ship 2 Harkinian\2s2h.exe'`),
    script,
  );
  assert(
    script.includes(
      String.raw`-WorkingDirectory 'C:\Games\2 Ship 2 Harkinian'`,
    ),
    script,
  );
});

Deno.test("a quote in the path can't break out of the PowerShell string", () => {
  const { args } = detachedCommand("C:/it's/game.exe", "C:/it's", "windows");
  const script = args[args.length - 1];
  assert(script.includes(String.raw`'C:\it''s\game.exe'`), script);
});

Deno.test("elsewhere the executable is run directly", () => {
  const { cmd, args } = detachedCommand("/opt/soh/soh", "/opt/soh", "linux");
  assertEquals(cmd, "/opt/soh/soh");
  assertEquals(args, []);
});
