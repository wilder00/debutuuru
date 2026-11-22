// "Go to the imported file": finds the imports and links of a file by its
// language and resolves them to files of the repository. Only paths are
// followed (no language server): relative imports, the project's own
// aliases (tsconfig paths, the go.mod module, workspace crates) and Markdown
// or HTML links. Packages from outside the repo aren't there to open.
//
// Finding is synchronous (regexes over the text, ≤ 2 MiB); resolving is async
// because it may read a config file (tsconfig.json, go.mod) and asks the agent
// which candidates exist (`git.stat_paths`).

export type Lang = "js" | "css" | "rust" | "go" | "markdown" | "html" | "python" | "c";

/** An import or link in the text: `from`/`to` cover the part to underline. */
export type Link = { from: number; to: number; spec: string; lang: Lang };

export function langOf(path: string): Lang | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (/^(m|c)?(j|t)sx?$|^vue$|^svelte$|^astro$/.test(ext)) return "js";
  if (/^(s?css|less|sass)$/.test(ext)) return "css";
  if (ext === "rs") return "rust";
  if (ext === "go") return "go";
  if (/^(md|markdown|mdx)$/.test(ext)) return "markdown";
  if (/^html?$/.test(ext)) return "html";
  if (/^pyi?$/.test(ext)) return "python";
  if (/^(c|cc|cpp|cxx|h|hh|hpp|hxx|m|mm)$/.test(ext)) return "c";
  return null;
}

/** Group 2 is the specifier (group 1 a quote, or empty). The `d` flag gives
 *  its exact position, which is what gets underlined. */
const PATTERNS: Record<Lang, RegExp[]> = {
  js: [
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*(['"])([^'"\n]+)\1/dg,
    /\bimport\s*(['"])([^'"\n]+)\1/dg,
    /\b(?:import|require)\s*\(\s*(['"])([^'"\n]+)\1\s*\)/dg,
  ],
  css: [/@(?:import|use|forward)\s+(?:url\(\s*)?(['"]?)([^'"\s);]+)\1/dg, /\burl\(\s*(['"]?)([^'")\s]+)\1\s*\)/dg],
  rust: [/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+()([A-Za-z_][A-Za-z0-9_]*)\s*;/dgm, /\buse\s+()((?:crate|super|self|[A-Za-z_][A-Za-z0-9_]*)(?:::[A-Za-z_][A-Za-z0-9_]*)+)/dg],
  go: [/(?:^|\s)(?:[A-Za-z_.]+\s+)?(")([^"\n]+)\1/dg],
  markdown: [/!?\[[^\]\n]*\]\(\s*<?()([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/dg, /^\s{0,3}\[[^\]\n]+\]:\s*<?()(\S+?)>?(?:\s|$)/dgm],
  html: [/\b(?:src|href)\s*=\s*(['"])([^'"\n]+)\1/dg],
  python: [/^\s*from\s+()(\.*[A-Za-z_][\w.]*|\.+)\s+import\b/dgm, /^\s*import\s+()([A-Za-z_][\w.]*)/dgm],
  c: [/^\s*#\s*(?:include|import)\s*(")([^"\n]+)\1/dgm],
};

/** Imports and links of `text`, for a file at `path`. */
export function findLinks(path: string, text: string): Link[] {
  const lang = langOf(path);
  if (!lang) return [];
  // Go: only inside import declarations (single or grouped).
  const scopes = lang === "go" ? goImportBlocks(text) : [[0, text.length] as const];
  const out: Link[] = [];
  for (const [start, end] of scopes) {
    const chunk = text.slice(start, end);
    for (const re of PATTERNS[lang]) {
      re.lastIndex = 0;
      for (let m = re.exec(chunk); m; m = re.exec(chunk)) {
        const spec = m[2];
        if (!spec || !worthLinking(lang, spec)) continue;
        const [from, to] = m.indices![2]!;
        out.push({ from: start + from, to: start + to, spec, lang });
      }
    }
  }
  // Two patterns can match the same import: keep one per position.
  out.sort((a, b) => a.from - b.from);
  return out.filter((l, i) => i === 0 || l.from >= out[i - 1].to);
}

function goImportBlocks(text: string): (readonly [number, number])[] {
  const blocks: [number, number][] = [];
  const re = /^\s*import\s*(\([\s\S]*?\)|"[^"\n]*")/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) blocks.push([m.index, m.index + m[0].length]);
  return blocks;
}

/** Leaves out what can't be a file of this repo. */
function worthLinking(lang: Lang, spec: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:(?!:)/i.test(spec) || spec.startsWith("//")) return false; // http:, data:, mailto:… (not Rust's a::b)
  if (spec.startsWith("#") || spec.startsWith("$") || spec.includes("${")) return false;
  if (lang === "rust") return !/^(std|core|alloc)::/.test(spec);
  return true;
}

// --- Resolution ------------------------------------------------------------

export type Resolver = {
  /** Text of a repo file, or null if it isn't there. */
  read: (path: string) => Promise<string | null>;
};

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** `a/b` + `../c/./d` → `a/c/d`; null if it climbs out of the repo. */
export function joinPath(base: string, rel: string): string | null {
  const parts = rel.startsWith("/") ? [] : base.split("/").filter(Boolean);
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

/** Folders from `dir` up to the root: `a/b` → [`a/b`, `a`, ``]. */
const ancestors = (dir: string) => {
  const out = [dir];
  for (let d = dir; d; ) out.push((d = dirOf(d)));
  return out;
};

const JS_EXT = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte", ".json", ".css"];

/** Where `link` (in the file at `from`) may point, most likely first. */
export async function candidates(link: Link, from: string, r: Resolver): Promise<string[]> {
  const dir = dirOf(from);
  const spec = decodeURIComponent(link.spec.split(/[?#]/)[0]);
  const rel = (base: string, p: string) => joinPath(base, p);
  const out: (string | null)[] = [];
  switch (link.lang) {
    case "js": {
      const bases: (string | null)[] = [];
      if (spec.startsWith(".") || spec.startsWith("/")) bases.push(rel(dir, spec));
      else bases.push(...(await tsconfigTargets(spec, dir, r)));
      for (const b of bases) {
        if (b === null) continue;
        // TS ESM imports name the output (`./x.js`) for a `./x.ts` source.
        const stem = b.replace(/\.(m|c)?js$/, "");
        out.push(b, ...JS_EXT.map((e) => stem + e), ...JS_EXT.map((e) => `${b}/index${e}`));
      }
      break;
    }
    case "css": {
      if (spec.startsWith("~")) break; // node_modules
      const b = rel(dir, spec);
      if (b === null) break;
      const [d, name] = [dirOf(b), b.slice(b.lastIndexOf("/") + 1)];
      const pre = d ? `${d}/` : "";
      out.push(b);
      for (const e of [".scss", ".sass", ".css", ".less"]) out.push(b + e, `${pre}_${name}${e}`, `${b}/_index${e}`, `${b}/index${e}`);
      break;
    }
    case "rust":
      out.push(...(await rustTargets(spec, from, r)));
      break;
    case "go": {
      if (spec.startsWith(".")) {
        out.push(rel(dir, spec));
        break;
      }
      for (const d of ancestors(dir)) {
        const mod = await r.read(d ? `${d}/go.mod` : "go.mod");
        const name = mod?.match(/^module\s+(\S+)/m)?.[1];
        if (!name) continue;
        if (spec === name) out.push(d);
        else if (spec.startsWith(name + "/")) out.push(rel(d, spec.slice(name.length + 1)));
        break;
      }
      break;
    }
    case "markdown":
    case "html":
      out.push(rel(spec.startsWith("/") ? "" : dir, spec));
      break;
    case "python": {
      const dots = spec.match(/^\.*/)![0].length;
      const mod = spec.slice(dots).replace(/\./g, "/");
      let bases: (string | null)[];
      if (dots) {
        let base: string | null = dir;
        for (let i = 1; i < dots && base !== null; i++) base = base ? dirOf(base) : null;
        bases = [base];
      } else bases = ["", "src", dir];
      for (const b of bases) {
        if (b === null) continue;
        const p = mod ? rel(b, mod) : b;
        if (p === null) continue;
        out.push(`${p}.py`, `${p}/__init__.py`, `${p}.pyi`, p);
      }
      break;
    }
    case "c":
      out.push(rel(dir, spec), spec, `include/${spec}`, `src/${spec}`);
      break;
  }
  return [...new Set(out.filter((p): p is string => p !== null && p !== undefined))];
}

/** `compilerOptions.paths` / `baseUrl` of the nearest tsconfig/jsconfig. */
async function tsconfigTargets(spec: string, dir: string, r: Resolver): Promise<string[]> {
  for (const d of ancestors(dir)) {
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      const text = await r.read(d ? `${d}/${name}` : name);
      if (text === null) continue;
      const opts = parseJsonc(text)?.compilerOptions ?? {};
      const base = joinPath(d, opts.baseUrl ?? ".") ?? d;
      const out: string[] = [];
      for (const [pattern, targets] of Object.entries<string[]>(opts.paths ?? {})) {
        const star = pattern.indexOf("*");
        const hit = star < 0 ? spec === pattern : spec.startsWith(pattern.slice(0, star)) && spec.endsWith(pattern.slice(star + 1));
        if (!hit) continue;
        const middle = star < 0 ? "" : spec.slice(star, spec.length - (pattern.length - star - 1));
        for (const t of targets) {
          const p = joinPath(base, t.replace("*", middle));
          if (p !== null) out.push(p);
        }
      }
      if (opts.baseUrl) {
        const p = joinPath(base, spec);
        if (p !== null) out.push(p);
      }
      return out;
    }
  }
  return [];
}

/** tsconfig allows comments and trailing commas. */
function parseJsonc(text: string): { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } } | null {
  try {
    const noComments = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, s) => s ?? "");
    return JSON.parse(noComments.replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return null;
  }
}

/** `mod x;`, `use crate::a::b`, `use super::x`, and workspace crates. */
async function rustTargets(spec: string, from: string, r: Resolver): Promise<string[]> {
  const dir = dirOf(from);
  const file = from.slice(from.lastIndexOf("/") + 1);
  // Folder holding this module's children: `src/` for lib.rs/main.rs/mod.rs,
  // `src/foo/` for `src/foo.rs`.
  const modDir = /^(lib|main|mod)\.rs$/.test(file) ? dir : joinPath(dir, file.replace(/\.rs$/, "")) ?? dir;
  const files = (base: string, segs: string[]) => {
    const out: string[] = [];
    // `a::b::Item`: the module may be `a/b` or `a` (Item defined in a.rs).
    for (let n = segs.length; n > 0; n--) {
      const p = joinPath(base, segs.slice(0, n).join("/"));
      if (p !== null) out.push(`${p}.rs`, `${p}/mod.rs`);
    }
    return out;
  };
  if (!spec.includes("::")) return files(modDir, [spec]); // `mod x;`
  const [head, ...rest] = spec.split("::");
  if (head === "self") return files(modDir, rest);
  if (head === "super") {
    let base = dirOf(modDir);
    while (rest[0] === "super") rest.shift(), (base = dirOf(base));
    return files(base, rest);
  }
  if (head === "crate") {
    for (const d of ancestors(dir)) {
      if ((await r.read(d ? `${d}/Cargo.toml` : "Cargo.toml")) !== null) return files(d ? `${d}/src` : "src", rest);
    }
    return [];
  }
  // Since Rust 2018 `use name::…` may be a module next to this one; else
  // another crate of the workspace (`debutuuru_core::files`), in the usual
  // layouts. Anything outside the repo simply won't be found.
  const dash = head.replace(/_/g, "-");
  const crates = [...new Set([`crates/${dash}`, dash, `crates/${head}`, head])];
  return [...files(modDir, [head, ...rest]), ...crates.flatMap((c) => [...files(`${c}/src`, rest), `${c}/src/lib.rs`])];
}
