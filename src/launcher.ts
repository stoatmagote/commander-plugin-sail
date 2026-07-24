// src/launcher.ts — launch a game executable from the Sail tab.
//
// The old commander had "run SoH / run 2S2H" buttons; this brings them back.
// The one non-obvious rule (ported from the legacy launcher): the game's cwd
// must be its own directory, because SoH/2S2H load their asset archives (*.o2r)
// relative to cwd. The spawn side is injected so this unit-tests without
// actually starting anything.

/** The bits of the OS the launcher needs — real impl below, faked in tests. */
export interface LaunchHost {
  /** Throw if the path doesn't exist. */
  stat(path: string): void;
  /** Start the executable detached, with `cwd` as its working directory. */
  spawn(path: string, cwd: string): void;
}

export const realLaunchHost: LaunchHost = {
  stat: (path) => {
    Deno.statSync(path);
  },
  spawn: (path, cwd) => {
    new Deno.Command(path, {
      cwd,
      stdout: "null",
      stderr: "null",
      stdin: "null",
    }).spawn();
  },
};

// ---------------------------------------------------------------------------
// Native "Browse…" file picker
// ---------------------------------------------------------------------------
//
// A browser <input type="file"> only yields the bare filename, not the full
// path Deno.Command needs — so the Browse button opens a real OS dialog on this
// (Deno) side. On Windows that's PowerShell's WinForms OpenFileDialog.

/** Runs a command and returns its stdout — injected so the picker unit-tests. */
export interface CommandRunner {
  run(cmd: string, args: string[]): Promise<{ stdout: string }>;
}

const realRunner: CommandRunner = {
  async run(cmd, args) {
    const out = await new Deno.Command(cmd, {
      args,
      stdout: "piped",
      stderr: "null",
    }).output();
    return { stdout: new TextDecoder().decode(out.stdout) };
  },
};

/** Opens a file dialog; resolves the chosen path, or null if cancelled. */
export interface FilePicker {
  pick(title: string): Promise<string | null>;
}

/** The PowerShell that shows an .exe open dialog and prints the chosen path. */
export function buildPickerScript(title: string): string {
  const safeTitle = title.replace(/'/g, "''");
  return [
    "Add-Type -AssemblyName System.Windows.Forms;",
    "$f = New-Object System.Windows.Forms.OpenFileDialog;",
    "$f.Filter = 'Executables (*.exe)|*.exe|All files (*.*)|*.*';",
    `$f.Title = '${safeTitle}';`,
    "if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK)",
    "{ [Console]::Out.Write($f.FileName) }",
  ].join(" ");
}

/** A file picker backed by PowerShell (Windows only; null elsewhere). */
export function makeFilePicker(
  runner: CommandRunner = realRunner,
  os: string = Deno.build.os,
): FilePicker {
  return {
    async pick(title) {
      if (os !== "windows") return null;
      try {
        const { stdout } = await runner.run("powershell", [
          "-NoProfile",
          "-STA",
          "-Command",
          buildPickerScript(title),
        ]);
        return stdout.trim() || null;
      } catch {
        return null;
      }
    },
  };
}

/** The directory containing a path (handles both `\` and `/`). */
export function dirOf(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx === -1 ? "." : norm.slice(0, idx);
}

/**
 * Launch the executable at `exePath`. Returns a result rather than throwing so
 * the tab can show a message. Validates the path exists first.
 */
export function launchGame(
  exePath: string,
  host: LaunchHost = realLaunchHost,
): { ok: boolean; error?: string } {
  const path = (exePath ?? "").trim();
  if (!path) {
    return {
      ok: false,
      error: "no executable path set — add one in the plugin settings",
    };
  }
  try {
    host.stat(path);
  } catch {
    return { ok: false, error: `not found: ${path}` };
  }
  try {
    host.spawn(path, dirOf(path));
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
