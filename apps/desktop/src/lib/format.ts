const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });

/** "3 hr. ago", "yesterday"… (seconds since epoch) */
export function relativeTime(unixSeconds: number, now = Date.now() / 1000): string {
  const diff = unixSeconds - now;
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  }
  return "just now";
}

export const fullDate = (unixSeconds: number) => new Date(unixSeconds * 1000).toLocaleString();

export type Ref = { kind: "head" | "branch" | "remote" | "tag"; name: string };

/** Parses `git log %D` decorations: "HEAD -> main", "origin/main", "tag: v1". */
export function parseRefs(refs: string[], remoteNames = ["origin", "upstream"]): Ref[] {
  return refs.map((r) => {
    if (r.startsWith("HEAD -> ")) return { kind: "head", name: r.slice(8) };
    if (r === "HEAD") return { kind: "head", name: "HEAD" };
    if (r.startsWith("tag: ")) return { kind: "tag", name: r.slice(5) };
    const slash = r.indexOf("/");
    if (slash > 0 && remoteNames.includes(r.slice(0, slash))) return { kind: "remote", name: r };
    return { kind: "branch", name: r };
  });
}

/** Splits "src/app/main.ts" into ["src/app/", "main.ts"]. */
export function splitPath(p: string): [string, string] {
  const i = p.lastIndexOf("/");
  return i < 0 ? ["", p] : [p.slice(0, i + 1), p.slice(i + 1)];
}
