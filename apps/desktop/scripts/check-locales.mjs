// Checks every translation against the English source (src/i18n/locales/en.json):
// - the same keys, no missing or extra ones;
// - plural keys (`name_one`, `name_other`…) cover exactly the CLDR plural
//   categories of that language, read from Intl.PluralRules (the same data
//   i18next uses at runtime);
// - the same {{variables}} and <code> tags as the English text.
// Run by `pnpm build`, so CI fails on an incomplete translation.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../src/i18n/locales");
const CATEGORIES = ["zero", "one", "two", "few", "many", "other"];
const PLURAL = new RegExp(`^(.*)_(${CATEGORIES.join("|")})$`);

/** { "a.b": "text" } from nested JSON. */
function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

/** Plural keys grouped under their base key; other keys as they are. */
function group(flat) {
  const groups = new Map();
  for (const [key, text] of Object.entries(flat)) {
    const m = PLURAL.exec(key);
    const [base, cat] = m ? [m[1], m[2]] : [key, null];
    if (!groups.has(base)) groups.set(base, { plural: new Map(), text: null });
    const g = groups.get(base);
    if (cat) g.plural.set(cat, text);
    else g.text = text;
  }
  return groups;
}

// Only <code> is a tag (mapped by <Trans>); "<url>" in a command is plain text.
const tokens = (s) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}|<\/?code>/g)].map((m) => m[0].replace(/\s/g, "")).sort().join(" ");
const sample = (g) => g.text ?? g.plural.get("other") ?? [...g.plural.values()][0];

const read = (file) => group(flatten(JSON.parse(readFileSync(join(dir, file), "utf8"))));
const source = read("en.json");
const errors = [];

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "en.json")) {
  const lang = file.replace(/\.json$/, "");
  const target = read(file);
  const needed = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
  for (const [key, g] of source) {
    const t = target.get(key);
    if (!t) {
      errors.push(`${lang}: missing "${key}"`);
      continue;
    }
    if (g.plural.size > 0) {
      const have = [...t.plural.keys()];
      const missing = needed.filter((c) => !t.plural.has(c));
      const extra = have.filter((c) => !needed.includes(c));
      if (missing.length) errors.push(`${lang}: "${key}" needs plural forms ${missing.map((c) => `_${c}`).join(", ")}`);
      if (extra.length) errors.push(`${lang}: "${key}" has plural forms ${lang} doesn't use: ${extra.map((c) => `_${c}`).join(", ")}`);
    }
    const want = tokens(sample(g));
    for (const text of t.plural.size ? t.plural.values() : [t.text]) {
      if (text !== null && tokens(text) !== want) errors.push(`${lang}: "${key}" has {{variables}}/<tags> [${tokens(text)}], English has [${want}]`);
    }
  }
  for (const key of target.keys()) if (!source.has(key)) errors.push(`${lang}: "${key}" doesn't exist in en.json`);
}

if (errors.length) {
  console.error(`Translations are out of sync with en.json:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log(`Translations OK (${source.size} keys)`);
