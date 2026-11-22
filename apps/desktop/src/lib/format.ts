import i18n from "../i18n";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];
// One formatter per UI language (creating one per commit row would be slow).
const formatters = new Map<string, Intl.RelativeTimeFormat>();
function rtf(lng: string): Intl.RelativeTimeFormat {
  let f = formatters.get(lng);
  if (!f) formatters.set(lng, (f = new Intl.RelativeTimeFormat(lng, { numeric: "auto", style: "short" })));
  return f;
}

/** "3 hr. ago", "yesterday", "3時間前"… in the UI language (seconds since epoch). */
export function relativeTime(unixSeconds: number, now = Date.now() / 1000): string {
  const diff = unixSeconds - now;
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diff) >= secs) return rtf(i18n.language).format(Math.round(diff / secs), unit);
  }
  return i18n.t("time.justNow");
}

export const fullDate = (unixSeconds: number) => new Date(unixSeconds * 1000).toLocaleString(i18n.language);

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

/** "812 B", "4.2 KB", "1.5 MB" (1024-based). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
