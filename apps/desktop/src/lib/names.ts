// Names that tell same-named folders apart, like VS Code's tab labels:
// `ssr-site` stays `ssr-site` while it's the only one; two of them become
// `ssr-site · NED-2550` and `ssr-site · NED-2611` (more parent folders are
// added until every name differs).

const segments = (path: string) => path.split(/[\\/]/).filter(Boolean);

/** One label per path, in the same order. */
export function distinctNames(paths: string[]): Map<string, string> {
  const segs = paths.map(segments);
  // How many parent folders each path shows.
  const depth = paths.map(() => 0);
  const label = (i: number) => {
    const s = segs[i];
    const name = s[s.length - 1] ?? paths[i];
    const parents = s.slice(Math.max(0, s.length - 1 - depth[i]), s.length - 1);
    return parents.length ? `${name} · ${parents.join("/")}` : name;
  };
  for (let round = 0; round < 64; round++) {
    const byLabel = new Map<string, number[]>();
    paths.forEach((p, i) => {
      if (byLabel.has(label(i)) && byLabel.get(label(i))!.some((j) => paths[j] === p)) return;
      byLabel.set(label(i), [...(byLabel.get(label(i)) ?? []), i]);
    });
    let changed = false;
    for (const same of byLabel.values()) {
      if (same.length < 2) continue;
      for (const i of same) {
        if (depth[i] < segs[i].length - 1) {
          depth[i]++;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return new Map(paths.map((p, i) => [p, label(i)]));
}
