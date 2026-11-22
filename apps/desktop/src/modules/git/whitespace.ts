// "Ignore whitespace" for @codemirror/merge (its `diffConfig.override`), like
// `git diff -w`: lines that only differ in spaces, tabs or indentation count
// as equal, so they are neither marked nor shown as changes. Lines that really
// changed still get the normal character-level diff, which is what marks the
// changed words.
import { Change, diff } from "@codemirror/merge";

/** Start offset of every line (plus one past the end). */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  if (starts[starts.length - 1] !== text.length) starts.push(text.length);
  return starts;
}

/** Each line as one character, equal when the lines are equal without
 *  whitespace. Characters skip the UTF-16 surrogate range so every line is
 *  exactly one code unit. Returns null if there are too many distinct lines. */
function encode(text: string, starts: number[], ids: Map<string, number>): string | null {
  let out = "";
  for (let i = 0; i + 1 < starts.length; i++) {
    const key = text.slice(starts[i], starts[i + 1]).replace(/\s+/g, "");
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    const code = 0x100 + id + (0x100 + id >= 0xd800 ? 0x800 : 0);
    if (code > 0xffff) return null;
    out += String.fromCharCode(code);
  }
  return out;
}

export function ignoreWhitespaceDiff(a: string, b: string): readonly Change[] {
  const sa = lineStarts(a);
  const sb = lineStarts(b);
  const ids = new Map<string, number>();
  const ea = encode(a, sa, ids);
  const eb = encode(b, sb, ids);
  if (ea === null || eb === null) return diff(a, b);
  const out: Change[] = [];
  // Line-level changes (one "character" per line), then a precise diff of
  // the changed lines, shifted back to positions in the real texts.
  for (const lc of diff(ea, eb)) {
    const fromA = sa[lc.fromA];
    const toA = sa[lc.toA];
    const fromB = sb[lc.fromB];
    const toB = sb[lc.toB];
    for (const c of diff(a.slice(fromA, toA), b.slice(fromB, toB))) {
      out.push(new Change(c.fromA + fromA, c.toA + fromA, c.fromB + fromB, c.toB + fromB));
    }
  }
  return out;
}
