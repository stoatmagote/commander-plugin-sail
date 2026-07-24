// scripts/parsers.ts — turn raw C source (enum / table headers) into id→name
// maps (COM-41). Ported from the legacy commander's lookups_parsers.ts.
//
// Pure functions, no I/O — so they unit-test against source snippets, and the
// same code can back a runtime "refresh" that re-reads the headers.

export type IdMap = Record<number, string>;

/** Pull a `typedef enum [Name] { … } [Name];` body out of a header. */
export function extractEnumBody(
  source: string,
  enumName: string,
): string | null {
  const re = /typedef\s+enum\s+(\w+)?\s*\{([\s\S]*?)\}\s*(\w+)?\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m[1] === enumName || m[3] === enumName) return m[2];
  }
  return null;
}

/**
 * Pull the body of whichever `typedef enum { … }` contains a given member —
 * SoH's item enum is anonymous, so we find it by a sentinel like "ITEM_BOTTLE".
 */
export function extractEnumBodyContaining(
  source: string,
  memberName: string,
): string | null {
  const re = /typedef\s+enum\s+(\w+)?\s*\{([\s\S]*?)\}\s*(\w+)?\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (new RegExp(`\\b${memberName}\\b`).test(m[2])) return m[2];
  }
  return null;
}

/**
 * Parse a C enum body into an id→name map. Honors explicit `= 0xNN`/`= NN`;
 * else a leading `/* 0xNN *\/` index comment; else a running counter. Skips
 * commented-out lines and entries whose value can't be resolved.
 */
export function parseEnum(body: string): IdMap {
  const out: IdMap = {};
  let next = 0;
  for (let line of body.split("\n")) {
    const idxComment = line.match(/\/\*\s*(0x[0-9a-fA-F]+|\d+)\s*\*\//);
    const hintedIndex = idxComment ? parseIntLoose(idxComment[1]) : null;
    line = line.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/, "").trim();
    if (!line) continue;

    const m = line.match(/^([A-Za-z_]\w*)\s*(?:=\s*([^,]+))?,?$/);
    if (!m) continue;
    const name = m[1];
    let value: number;
    if (m[2] !== undefined) {
      const explicit = parseIntLoose(m[2].trim());
      if (explicit === null) continue;
      value = explicit;
    } else if (hintedIndex !== null) {
      value = hintedIndex;
    } else {
      value = next;
    }
    out[value] = name;
    next = value + 1;
  }
  return out;
}

/**
 * Parse a scene table (`DEFINE_SCENE(…)`). Prefers a trailing quoted display
 * name (2S2H adds one) over the SCENE_* enum identifier. Skips
 * DEFINE_SCENE_UNSET.
 */
export function parseSceneTable(source: string): IdMap {
  return parseTable(source, "SCENE");
}

/**
 * Parse an actor table (`DEFINE_ACTOR(…)` / `DEFINE_ACTOR_INTERNAL`). Prefers a
 * trailing quoted description ("Cucco", …) over the ACTOR_* enum name. Skips
 * DEFINE_ACTOR_UNSET.
 */
export function parseActorTable(source: string): IdMap {
  return parseTable(source, "ACTOR");
}

export interface ActorEntry {
  id: number;
  enumName: string; // e.g. "ACTOR_EN_NIW"
  displayName: string; // friendly description, or the enum name if none
}

/**
 * Like parseActorTable, but keeps each entry's ACTOR_* enum name — needed to
 * match the same actor across SoH and 2S2H (their numeric ids differ, but the
 * enum names line up).
 */
export function parseActorTableEntries(source: string): ActorEntry[] {
  const out: ActorEntry[] = [];
  let running = 0;
  for (const line of source.split("\n")) {
    const idxComment = line.match(/\/\*\s*(0x[0-9a-fA-F]+|\d+)\s*\*\//);
    const index = (idxComment ? parseIntLoose(idxComment[1]) : null) ?? running;

    if (/DEFINE_ACTOR_UNSET\s*\(/.test(line)) {
      running = index + 1;
      continue;
    }
    const macro = /DEFINE_ACTOR_INTERNAL\s*\(/.test(line)
      ? "DEFINE_ACTOR_INTERNAL"
      : "DEFINE_ACTOR";
    const inner = extractMacroArgs(line, macro);
    if (inner === null) continue;

    const args = splitArgs(inner);
    const enumArg = args.find((a) => /^ACTOR_\w+/.test(a.trim()));
    if (!enumArg) {
      running = index + 1;
      continue;
    }
    const quoted = inner.match(/"([^"]*)"/g);
    const displayName = quoted && quoted.length > 0
      ? quoted[quoted.length - 1].replace(/"/g, "")
      : enumArg.trim();
    out.push({ id: index, enumName: enumArg.trim(), displayName });
    running = index + 1;
  }
  return out;
}

/** Shared DEFINE_<KIND>(…) table parser. */
function parseTable(source: string, kind: "ACTOR" | "SCENE"): IdMap {
  const out: IdMap = {};
  let running = 0;
  const define = `DEFINE_${kind}`;
  const enumRe = new RegExp(`^${kind}_\\w+`);

  for (const line of source.split("\n")) {
    const idxComment = line.match(/\/\*\s*(0x[0-9a-fA-F]+|\d+)\s*\*\//);
    const index = (idxComment ? parseIntLoose(idxComment[1]) : null) ?? running;

    if (new RegExp(`${define}_UNSET\\s*\\(`).test(line)) {
      running = index + 1;
      continue;
    }
    const macro = kind === "ACTOR" && /DEFINE_ACTOR_INTERNAL\s*\(/.test(line)
      ? "DEFINE_ACTOR_INTERNAL"
      : define;
    const inner = extractMacroArgs(line, macro);
    if (inner === null) continue;

    const args = splitArgs(inner);
    const quoted = inner.match(/"([^"]*)"/g);
    const enumArg = args.find((a) => enumRe.test(a.trim()));
    const label = quoted && quoted.length > 0
      ? quoted[quoted.length - 1].replace(/"/g, "")
      : (enumArg ?? args[1] ?? `${kind}_${index}`).trim();
    out[index] = label;
    running = index + 1;
  }
  return out;
}

/**
 * Given a line containing `MACRO(…)`, return the argument string between the
 * balanced parens. Handles nested parens and ignores parens inside strings.
 */
function extractMacroArgs(line: string, macroName: string): string | null {
  const re = new RegExp(macroName + "\\s*\\(");
  const m = re.exec(line);
  if (!m) return null;
  return scanBalanced(line, m.index + m[0].length - 1);
}

function scanBalanced(line: string, openParenIdx: number): string | null {
  if (line[openParenIdx] !== "(") return null;
  let depth = 0;
  let inStr = false;
  for (let i = openParenIdx; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return line.slice(openParenIdx + 1, i);
    }
  }
  return null; // unbalanced (macro spans lines — not expected in these tables)
}

function splitArgs(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (const ch of inner) {
    if (ch === '"') inStr = !inStr;
    if (!inStr && ch === "(") depth++;
    if (!inStr && ch === ")") depth--;
    if (!inStr && ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function parseIntLoose(s: string): number | null {
  s = s.trim();
  const n = /^0x/i.test(s) ? parseInt(s, 16) : parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}
