// src/fuzzy.ts — resolve a chat-typed name to a catalog entry (COM-50).
//
// `!spawn cucco` should just work; `!spawn cuko` should reply "did you mean
// cucco?". The rule: an exact or unambiguous prefix/word match wins outright;
// otherwise return the closest few names as suggestions.

export type MatchResult<T> =
  | { kind: "match"; entry: T }
  | { kind: "suggest"; entries: T[] }
  | { kind: "none" };

/** Lowercase, and reduce any run of non-alphanumerics to a single space. */
export function normalize(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function fuzzyResolve<T>(
  query: string,
  entries: readonly T[],
  nameOf: (entry: T) => string,
  limit = 3,
): MatchResult<T> {
  const q = normalize(query);
  if (!q) return { kind: "none" };

  const scored = entries.map((entry) => ({
    entry,
    name: normalize(nameOf(entry)),
  }));

  const exact = scored.filter((s) => s.name === q);
  if (exact.length === 1) return { kind: "match", entry: exact[0].entry };
  if (exact.length > 1) {
    return {
      kind: "suggest",
      entries: exact.slice(0, limit).map((s) => s.entry),
    };
  }

  // A strong match: the query is a whole word of the name, or the name starts
  // with the query. Unique → take it; several → offer the shortest names.
  const strong = scored.filter((s) =>
    s.name.startsWith(q) || s.name.split(" ").includes(q)
  );
  if (strong.length === 1) return { kind: "match", entry: strong[0].entry };
  if (strong.length > 1) {
    const byShortest = strong
      .sort((a, b) => a.name.length - b.name.length)
      .slice(0, limit)
      .map((s) => s.entry);
    return { kind: "suggest", entries: byShortest };
  }

  // Otherwise, nearest by edit distance (typo tolerance).
  const near = scored
    .map((s) => ({ entry: s.entry, sim: similarity(q, s.name) }))
    .filter((s) => s.sim >= 0.6)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, limit)
    .map((s) => s.entry);
  return near.length > 0
    ? { kind: "suggest", entries: near }
    : { kind: "none" };
}

/** 1 = identical, 0 = nothing in common, by normalized edit distance. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
