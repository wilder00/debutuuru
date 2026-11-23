// "Go to definition" without a language server: Ctrl+click on a name (a
// function, variable, constant, type, field…) finds where it is defined with
// per-language patterns. In order:
//   1. If the file imports the name, the imported file (resolved like
//      Ctrl+click on an import), at the name's definition there.
//   2. A definition in the same file (the nearest one above the click, for
//      locals).
//   3. The whole repository with `git grep`, same language only.
// There are no types: for `obj.save()` every `save` definition is offered.
//
// Patterns are written once as JS regexes and translated to POSIX extended
// ones for git grep, so they only use what both understand: groups,
// alternation, classes, `\s` and `\w` (no lookarounds, no `\b`, no lazy
// quantifiers, never `\]` inside a class). `@@` stands for the name.

import type { GrepMatch } from "../../bindings/GrepMatch";
import { candidates, type Lang } from "./links";

/** The name under the cursor. */
export type Sym = {
  name: string;
  /** Offsets of the name in the file. */
  from: number;
  to: number;
  /** 1-based line of the click. */
  line: number;
  /** Comes after `.`, `::` or `->` (a field or method). */
  member: boolean;
  /** What comes before that: `this`, `self`, `git`… */
  receiver?: string;
};

/** A place where the name is defined. */
export type Def = { path: string; line: number; text: string };

export type Rules = {
  /** Characters of a name. */
  word: RegExp;
  keywords: Set<string>;
  /** Definitions. */
  strong: string[];
  /** Definitions of local variables only (`let x`, `const { x } = obj`):
   *  never what `obj.x` means. */
  locals?: string[];
  /** Less certain ones (fields, keys, enum members…), used when the strong
   *  ones find nothing. */
  weak: string[];
  /** Git pathspecs of the language's files. */
  files: string[];
  /** Whether a name is worth looking for (`before`: the line up to it). */
  accept?: (name: string, before: string) => boolean;
  /** Lines that only mention the name (imports). */
  skip?: RegExp;
  /** Import resolution, for languages that name what they import. */
  imports?: "js" | "rust" | "python";
};

const kw = (s: string) => new Set(s.split(" "));
const COMMON =
  "if else for while do switch case break continue return true false null new this super try catch finally throw import export from default async await yield in of";

const JS: Rules = {
  word: /[\w$]/,
  keywords: kw(COMMON + " function class const let var typeof instanceof void delete extends implements interface type enum public private protected static readonly as undefined"),
  strong: [
    "(^|[^\\w$.])(function\\s*\\*?|class|interface|type|enum|namespace)\\s+@@([^\\w$]|$)",
    "(^|[^\\w$.])(const|let|var)\\s+@@([^\\w$]|$)",
    // Array destructuring: `const [@@, set@@] = useState()`.
    "(^|[^\\w$.])(const|let|var)\\s*\\[\\s*([^=]*[^\\w$.])?@@([^\\w$]|$)",
    // Methods: `async @@(a: T): R {` on its own line.
    "^\\s*((export|default|public|private|protected|static|async|readonly|override|abstract|get|set|declare)\\s+)*\\*?@@\\s*(<[^>]*>)?\\([^;]*\\)\\s*(:[^;=]*)?\\{\\s*$",
  ],
  // Object destructuring: `const { a, @@ } = obj` takes what obj defines.
  locals: ["(^|[^\\w$.])(const|let|var)\\s*\\{\\s*([^=]*[^\\w$.])?@@([^\\w$]|$)"],
  weak: [
    // Fields, object keys, interface members: `@@: T`, `@@ = 1`, `@@?: T`.
    "^\\s*((export|public|private|protected|static|readonly|declare|override|abstract)\\s+)*@@\\??\\s*[:=]([^=>]|$)",
    // Enum members, one per line.
    "^\\s*@@\\s*,?\\s*$",
  ],
  files: ["*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.cjs", "*.mts", "*.cts", "*.vue", "*.svelte", "*.astro"],
  skip: /^\s*(import\s|export\s.*\sfrom\s)/,
  imports: "js",
};

const RUST: Rules = {
  word: /\w/,
  keywords: kw(COMMON + " fn let mut struct enum trait impl type mod use pub crate self Self const static match loop where as ref move dyn unsafe extern"),
  strong: [
    "(^|[^\\w])(fn|struct|enum|trait|type|union|mod|const|static|static\\s+mut)\\s+@@([^\\w]|$)",
    "(^|[^\\w])macro_rules!\\s*@@([^\\w]|$)",
  ],
  locals: ["(^|[^\\w])let\\s+(mut\\s+)?@@([^\\w]|$)"],
  weak: [
    // Struct fields.
    "^\\s*(pub(\\([^)]*\\))?\\s+)?@@\\s*:([^:]|$)",
    // Enum variants: `@@,`, `@@(T),`, `@@ {`.
    "^\\s*@@\\s*(,|\\{|\\(.*\\)\\s*,?|\\{.*\\}\\s*,?)?\\s*$",
  ],
  files: ["*.rs"],
  skip: /^\s*(pub(\([^)]*\))?\s+)?use\s/,
  imports: "rust",
};

const GO: Rules = {
  word: /\w/,
  keywords: kw(COMMON + " func var const type struct interface package range go defer select chan map nil fallthrough goto"),
  strong: [
    "(^|[^\\w])func\\s+(\\([^)]*\\)\\s*)?@@\\s*[[(]",
    "(^|[^\\w])(type|var|const)\\s+@@([^\\w]|$)",
  ],
  locals: ["(^|[^\\w])([\\w]+\\s*,\\s*)*@@(\\s*,\\s*[\\w]+)*\\s*:="],
  weak: [
    // Struct fields and members of `var (…)` / `const (…)` blocks.
    "^\\s*@@(\\s*,\\s*[\\w]+)*\\s+[*[\\w.]",
    "^\\s*@@\\s*=([^=]|$)",
  ],
  files: ["*.go"],
};

const PYTHON: Rules = {
  word: /\w/,
  keywords: kw(COMMON + " def class lambda pass elif except raise with as not and or is None True False global nonlocal del assert self"),
  strong: [
    "(^|[^\\w])(def|class)\\s+@@\\s*[(:[]",
    "^\\s*@@\\s*(:[^=]*)?=([^=]|$)",
    "^\\s*([\\w.]+\\s*,\\s*)+@@(\\s*,\\s*[\\w.]+)*\\s*=([^=]|$)",
  ],
  locals: ["(^|[^\\w])for\\s+([\\w]+\\s*,\\s*)*@@\\s*(,|in[^\\w])", "(^|[^\\w])as\\s+@@\\s*[:,)]"],
  // Attributes set in methods: `self.@@ = …`.
  weak: ["^\\s*self\\.@@\\s*(:[^=]*)?=([^=]|$)"],
  files: ["*.py", "*.pyi"],
  skip: /^\s*(from|import)\s/,
  imports: "python",
};

const C: Rules = {
  word: /\w/,
  keywords: kw(COMMON + " struct enum union typedef sizeof static const extern int char void long short unsigned signed float double auto goto register volatile inline class namespace template typename using public private protected virtual"),
  strong: [
    "^\\s*#\\s*define\\s+@@([^\\w]|$)",
    "(^|[^\\w])(struct|enum|union|class|namespace)\\s+@@\\s*(\\{|:([^:]|$)|$)",
    "(^|[^\\w])typedef\\s[^;]*[^\\w]@@\\s*(\\[[^;]*)?;",
    "^\\}\\s*@@\\s*;",
    "(^|[^\\w])using\\s+@@\\s*=",
    // Function definitions: not indented, and no `;` (not a prototype).
    "^[\\w][\\w\\s*&:<>,]*[\\s*&:]@@\\s*\\([^;]*$",
  ],
  weak: [
    // Prototypes, variables, fields, enum members.
    "^[\\w][\\w\\s*&:<>,]*[\\s*&]@@\\s*\\(.*\\)\\s*;",
    "^\\s*[\\w][\\w\\s*&:<>,]*[\\s*&]@@\\s*(=([^=]|$)|;|\\[|,)",
    "^\\s*@@\\s*(=[^=].*)?,?\\s*$",
  ],
  files: ["*.c", "*.h", "*.cc", "*.cpp", "*.cxx", "*.hh", "*.hpp", "*.hxx", "*.m", "*.mm"],
};

const CSS: Rules = {
  word: /[\w$-]/,
  keywords: new Set(),
  // Custom properties (`--x:`), Sass variables (`$x:`), mixins and functions.
  strong: ["(^|[^\\w-])@@\\s*:", "@(mixin|function)\\s+@@([^\\w-]|$)"],
  weak: [],
  accept: (name, before) => name.startsWith("--") || name.startsWith("$") || /@include\s*$/.test(before),
  files: ["*.css", "*.scss", "*.sass", "*.less"],
};

/** Languages without their own rules: the usual definition keywords. */
const GENERIC_EXT = new Set(
  "java kt kts scala groovy gradle cs fs php rb sh bash zsh fish lua swift dart ex exs erl hs ml mli r pl pm ps1 psm1 zig nim jl clj cljs elm".split(" "),
);
const generic = (ext: string): Rules => ({
  word: /[\w$]/,
  keywords: kw(COMMON + " function def fn func fun sub class struct interface trait enum type module object const let var val local end then fi"),
  strong: ["(^|[^\\w$])(function|def|fn|func|fun|sub|class|struct|interface|trait|enum|type|module|object|const|let|var|val|local)\\s+@@([^\\w$]|$)"],
  // Shell functions and assignments.
  weak: ["^\\s*@@\\s*\\(\\)\\s*\\{", "^\\s*@@\\s*=([^=]|$)"],
  files: [`*.${ext}`],
});

const BY_LANG: Partial<Record<Lang, Rules>> = { js: JS, rust: RUST, go: GO, python: PYTHON, c: C, css: CSS };

/** How names are found in this file, or null if they aren't (Markdown, JSON…). */
export function rulesFor(path: string, lang: Lang | null): Rules | null {
  if (lang) return BY_LANG[lang] ?? null;
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return GENERIC_EXT.has(ext) ? generic(ext) : null;
}

/** The name around `pos` in `line` (which starts at `lineFrom`), if any. */
export function nameAt(rules: Rules, line: string, lineFrom: number, lineNo: number, pos: number): Sym | null {
  const i = pos - lineFrom;
  let a = i;
  let b = i;
  while (a > 0 && rules.word.test(line[a - 1])) a--;
  while (b < line.length && rules.word.test(line[b])) b++;
  const name = line.slice(a, b);
  if (!name || /^[0-9]/.test(name) || /^-?[0-9.]+[a-z%]*$/i.test(name) || rules.keywords.has(name)) return null;
  const before = line.slice(0, a).trimEnd();
  if (rules.accept && !rules.accept(name, before)) return null;
  const member = /(\.|::|->)$/.test(before) && !/\.\.$/.test(before);
  const receiver = member ? before.replace(/(\.|::|->)$/, "").match(/[\w$]+$/)?.[0] : undefined;
  return { name, from: lineFrom + a, to: lineFrom + b, line: lineNo, member, receiver };
}

// --- Patterns --------------------------------------------------------------

const escName = (name: string) => name.replace(/[$.]/g, "\\$&");

const fill = (tpl: string, name: string) => tpl.split("@@").join(escName(name));

/** One JS regex for a set of templates. */
function jsRegex(tpls: string[], name: string): RegExp | null {
  return tpls.length ? new RegExp(tpls.map((t) => `(?:${fill(t, name)})`).join("|")) : null;
}

/** The same template as a POSIX extended regex (what git grep -E takes). */
export function toEre(tpl: string): string {
  let out = "";
  let inClass = false;
  for (let i = 0; i < tpl.length; i++) {
    const c = tpl[i];
    if (c === "\\" && i + 1 < tpl.length) {
      const n = tpl[++i];
      if (n === "s") out += inClass ? "[:space:]" : "[[:space:]]";
      else if (n === "w") out += inClass ? "A-Za-z0-9_" : "[A-Za-z0-9_]";
      // Inside a class a backslash is literal in POSIX: keep only the char.
      else out += inClass ? n : "\\" + n;
      continue;
    }
    if (c === "[" && !inClass) {
      inClass = true;
      out += c;
      if (tpl[i + 1] === "^") out += tpl[++i];
      continue;
    }
    if (c === "]" && inClass) inClass = false;
    out += c;
  }
  return out;
}

/** Lines of `text` matching `re`, as definitions in `path`. */
function searchText(path: string, text: string, re: RegExp | null, skip?: RegExp): Def[] {
  if (!re) return [];
  const out: Def[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (re.test(l) && !skip?.test(l)) out.push({ path, line: i + 1, text: l.trim().slice(0, 300) });
  }
  return out;
}

/** The definition nearest above `line` (locals shadow), else the first below. */
function nearest(defs: Def[], line: number): Def | undefined {
  const above = defs.filter((d) => d.line < line);
  return above.length ? above[above.length - 1] : defs.find((d) => d.line > line);
}

// --- Imports ---------------------------------------------------------------

/** Where an imported name comes from: the module and its name there
 *  (`default` for a default import, `*` for the module itself). */
type Imported = { spec: string; orig: string };

function jsImport(text: string, name: string): Imported | null {
  const re = /\bimport\s+(?:type\s+)?([^'";]*?)\s+from\s*(['"])([^'"\n]+)\2/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const clause = m[1];
    const spec = m[3];
    if (new RegExp(`\\*\\s*as\\s+${escName(name)}$`).test(clause.trim())) return { spec, orig: "*" };
    const def = clause.match(/^\s*([\w$]+)\s*(,|$)/);
    if (def?.[1] === name) return { spec, orig: "default" };
    const braces = clause.match(/\{([^}]*)\}/);
    for (const item of braces?.[1].split(",") ?? []) {
      const p = item.trim().match(/^(?:type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?$/);
      if (p && (p[2] ?? p[1]) === name) return { spec, orig: p[1] };
    }
  }
  const req = new RegExp(`\\b(?:const|let|var)\\s+${escName(name)}\\s*=\\s*require\\(\\s*(['"])([^'"\\n]+)\\1`).exec(text);
  return req ? { spec: req[2], orig: "default" } : null;
}

/** `use a::b::{c, d as e, f::{g}};` → every full path with its local name. */
function rustUses(text: string): { path: string; local: string }[] {
  const out: { path: string; local: string }[] = [];
  const walk = (prefix: string, body: string) => {
    let depth = 0;
    let start = 0;
    const items: string[] = [];
    for (let i = 0; i <= body.length; i++) {
      const c = body[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if ((c === "," && depth === 0) || i === body.length) {
        items.push(body.slice(start, i).trim());
        start = i + 1;
      }
    }
    for (const item of items.filter(Boolean)) {
      const nested = item.match(/^([\w:]*?)(?:::)?\{([\s\S]*)\}$/);
      if (nested) {
        walk(prefix + nested[1] + (nested[1] ? "::" : ""), nested[2]);
        continue;
      }
      const m = item.match(/^([\w:]+?)(?:\s+as\s+(\w+))?$/);
      if (!m) continue;
      const full = m[1] === "self" ? prefix.replace(/::$/, "") : prefix + m[1];
      out.push({ path: full, local: m[2] ?? full.split("::").pop()! });
    }
  };
  const re = /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([^;]+);/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) walk("", m[1].replace(/\s+/g, " "));
  return out;
}

function rustImport(text: string, name: string): Imported | null {
  const u = rustUses(text).find((x) => x.local === name);
  if (!u || !u.path.includes("::")) return null;
  return { spec: u.path, orig: u.path.split("::").pop()! };
}

function pythonImport(text: string, name: string): Imported | null {
  const re = /^\s*from\s+(\S+)\s+import\s+(\([^)]*\)|[^\n#]+)/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    for (const item of m[2].replace(/[()]/g, "").split(",")) {
      const p = item.trim().match(/^(\w+)(?:\s+as\s+(\w+))?$/);
      if (p && (p[2] ?? p[1]) === name) return { spec: m[1], orig: p[1] };
    }
  }
  const imp = new RegExp(`^\\s*import\\s+([\\w.]+)\\s+as\\s+${name}\\s*$`, "m").exec(text);
  return imp ? { spec: imp[1], orig: "*" } : null;
}

// --- Finding ---------------------------------------------------------------

export type Finder = {
  /** Text of a file, or null if it isn't there. */
  read: (path: string) => Promise<string | null>;
  /** What each path is (`file`, `dir`…), or null. */
  stat: (paths: string[]) => Promise<(string | null)[]>;
  /** Search the whole repository; null where there is none (a plain folder). */
  grep: ((patterns: string[], files: string[]) => Promise<GrepMatch[]>) | null;
};

export type Found = {
  defs: Def[];
  /** The click was on the definition itself and there's no other. */
  here: boolean;
};

/** Where `sym` (in the file at `path` with `text`) is defined. */
export async function findDefinitions(sym: Sym, path: string, text: string, lang: Lang | null, f: Finder): Promise<Found> {
  const rules = rulesFor(path, lang);
  if (!rules) return { defs: [], here: false };
  const { name } = sym;
  const self = (d: Def) => d.path === path && d.line === sym.line;
  // Locals only count in this file, and never after a dot.
  const strong = jsRegex(sym.member ? rules.strong : [...rules.strong, ...(rules.locals ?? [])], name);
  const weak = jsRegex(rules.weak, name);
  const one = (d: Def | undefined): Found | null => (d ? { defs: [d], here: false } : null);

  // 1. Imported from another file of the repo.
  if (!sym.member && rules.imports && lang) {
    const imp = rules.imports === "js" ? jsImport(text, name) : rules.imports === "rust" ? rustImport(text, name) : pythonImport(text, name);
    if (imp) {
      const hit = await inImported(imp, lang, path, rules, f);
      if (hit) return { defs: [hit], here: false };
      // A re-export (`export * from`…): look for the original name everywhere.
      if (imp.orig !== "*" && imp.orig !== "default" && imp.orig !== name) return findDefinitions({ ...sym, name: imp.orig }, path, text, lang, f);
    }
  }

  // 2. This file.
  const local = searchText(path, text, strong, rules.skip);
  const onDef = local.some(self);
  const others = local.filter((d) => !self(d));
  if (!sym.member) {
    const hit = one(nearest(others, sym.line));
    if (hit) return hit;
  } else if (sym.receiver && /^(this|self|Self)$/.test(sym.receiver)) {
    // `this.x`: this file's class, most likely.
    const all = [...others, ...searchText(path, text, weak, rules.skip).filter((d) => !self(d))];
    if (all.length === 1) return one(all[0])!;
  }

  // 3. The repository.
  if (f.grep) {
    for (const tpls of [rules.strong, rules.weak]) {
      if (!tpls.length) continue;
      const found = (await f.grep(tpls.map((t) => toEre(fill(t, name))), rules.files)).filter((m) => !rules.skip?.test(m.text) && !self(m));
      if (found.length) return { defs: rank(found.map((m) => ({ ...m, text: m.text.trim() })), path), here: false };
    }
  } else if (!sym.member) {
    const hit = one(nearest(searchText(path, text, weak, rules.skip).filter((d) => !self(d)), sym.line));
    if (hit) return hit;
  }
  return { defs: [], here: onDef };
}

/** This file first, then its folder, then the rest by path. */
function rank(defs: Def[], from: string): Def[] {
  const dir = from.slice(0, from.lastIndexOf("/") + 1);
  const score = (d: Def) => (d.path === from ? 0 : d.path.startsWith(dir) && !d.path.slice(dir.length).includes("/") ? 1 : 2);
  const seen = new Set<string>();
  return defs
    .filter((d) => {
      const k = `${d.path}:${d.line}`;
      return !seen.has(k) && (seen.add(k), true);
    })
    .sort((a, b) => score(a) - score(b) || a.path.localeCompare(b.path) || a.line - b.line);
}

/** The definition of an imported name in the file it comes from. */
async function inImported(imp: Imported, lang: Lang, from: string, rules: Rules, f: Finder): Promise<Def | null> {
  const paths = await candidates({ from: 0, to: 0, spec: imp.spec, lang }, from, { read: f.read });
  for (let i = 0; i < paths.length; i += 64) {
    const chunk = paths.slice(i, i + 64);
    const kinds = await f.stat(chunk);
    const k = kinds.findIndex((kind) => kind === "file");
    if (k < 0) continue;
    const file = chunk[k];
    if (imp.orig === "*") return { path: file, line: 1, text: "" };
    const text = await f.read(file);
    if (text === null) return null;
    if (imp.orig === "default") {
      const defs = searchText(file, text, /^\s*export\s+default\s/);
      const named = defs[0]?.text.match(/^export\s+default\s+([\w$]+)\s*;?\s*$/);
      if (named) return searchText(file, text, jsRegex(rules.strong, named[1]), rules.skip)[0] ?? defs[0];
      return defs[0] ?? { path: file, line: 1, text: "" };
    }
    return searchText(file, text, jsRegex(rules.strong, imp.orig), rules.skip)[0] ?? searchText(file, text, jsRegex(rules.weak, imp.orig), rules.skip)[0] ?? null;
  }
  return null;
}
