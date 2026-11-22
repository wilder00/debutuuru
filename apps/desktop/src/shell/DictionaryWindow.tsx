// UI dictionary: every text of the interface in the UI language beside the
// same text in another language, to learn words from the app you use every
// day. An extra, not part of the core: it opens in its own window from the
// command palette or the language settings, and only reads the translations
// the app already ships.
import { BookA, Eye, EyeOff, Shuffle } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n, { LANGUAGES, type Language } from "../i18n";
import { ToolWindow } from "./ToolWindow";

type Entry = { key: string; section: string; plural: string | null; from: string; to: string };
type Tree = { [k: string]: string | Tree };

const PLURAL = /_(zero|one|two|few|many|other)$/;
const TARGET_KEY = "debutuuru.dictionary.target";

function flatten(tree: Tree, prefix = "", out = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else flatten(v, key, out);
  }
  return out;
}

const bundle = (lng: string) => flatten((i18n.getResourceBundle(lng, "translation") ?? {}) as Tree);

/** `{{count}}` and other placeholders, shown apart from the words. */
function Text({ value, lang }: { value: string; lang: string }) {
  return (
    <span lang={lang}>
      {value.split(/(\{\{[^}]+\}\}|<\/?code>)/).map((part, i) =>
        /^\{\{/.test(part) ? (
          <span key={i} className="dict-var">
            {part.slice(2, -2)}
          </span>
        ) : /^<\/?code>$/.test(part) ? null : (
          part
        ),
      )}
    </span>
  );
}

const loadTarget = (ui: string): Language => {
  try {
    const saved = localStorage.getItem(TARGET_KEY);
    if (saved && LANGUAGES.some((l) => l.code === saved) && saved !== ui) return saved as Language;
  } catch {
    // Storage can be unavailable; the default is fine.
  }
  return ui === "en" ? "es" : "en";
};

export function DictionaryWindow() {
  const { t, i18n: inst } = useTranslation();
  const ui = inst.resolvedLanguage ?? inst.language;
  const [target, setTargetState] = useState<Language>(() => loadTarget(ui));
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("");
  const [short, setShort] = useState(true);
  const [hide, setHide] = useState(false);
  const [order, setOrder] = useState<number[] | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const setTarget = (l: Language) => {
    setTargetState(l);
    setRevealed(new Set());
    try {
      localStorage.setItem(TARGET_KEY, l);
    } catch {
      // Not remembered this time.
    }
  };

  const entries = useMemo<Entry[]>(() => {
    const from = bundle(ui);
    const to = bundle(target);
    const en = bundle("en");
    const keys = new Set([...from.keys(), ...to.keys()]);
    const out: Entry[] = [];
    for (const key of keys) {
      const f = from.get(key) ?? en.get(key);
      const tt = to.get(key) ?? en.get(key);
      if (!f || !tt) continue;
      const m = key.match(PLURAL);
      out.push({ key, section: key.split(".")[0], plural: m ? m[1] : null, from: f, to: tt });
    }
    return out;
  }, [ui, target]);

  const sections = useMemo(() => [...new Set(entries.map((e) => e.section))].sort(), [entries]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const words = (s: string) => s.trim().split(/\s+/).length;
    // CJK has no spaces: count characters instead.
    const isShort = (e: Entry) => (/[぀-ヿ㐀-鿿가-힯]/.test(e.to) ? e.to.length <= 12 : words(e.to) <= 4) && words(e.from) <= 6;
    const list = entries.filter(
      (e) =>
        (!section || e.section === section) &&
        (!short || isShort(e)) &&
        (!q || e.from.toLowerCase().includes(q) || e.to.toLowerCase().includes(q) || e.key.toLowerCase().includes(q)),
    );
    if (!order) return list;
    return list.map((e, i) => ({ e, r: order[i % order.length] ?? i })).sort((a, b) => a.r - b.r).map((x) => x.e);
  }, [entries, query, section, short, order]);

  const shuffle = () => setOrder(Array.from({ length: Math.max(entries.length, 1) }, () => Math.random()) as number[]);
  const langName = (code: string) => LANGUAGES.find((l) => l.code === code)?.name ?? code;

  const toolbar = (
    <>
      <input className="tool-filter" value={query} placeholder={t("dictionary.search")} aria-label={t("dictionary.search")} spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
      <label className="inline-field">
        {t("dictionary.learn")}
        <select value={target} onChange={(e) => setTarget(e.target.value as Language)}>
          {LANGUAGES.filter((l) => l.code !== ui).map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <select value={section} aria-label={t("dictionary.section")} onChange={(e) => setSection(e.target.value)}>
        <option value="">{t("dictionary.allSections")}</option>
        {sections.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <label className="toggle-row inline" title={t("dictionary.shortHint")}>
        <input type="checkbox" checked={short} onChange={(e) => setShort(e.target.checked)} /> {t("dictionary.short")}
      </label>
      <span className="spacer" />
      <span className="hint">{t("dictionary.count", { count: shown.length })}</span>
      <button className={"icon-btn" + (order ? " on" : "")} aria-pressed={!!order} title={order ? t("dictionary.inOrder") : t("dictionary.shuffle")} onClick={() => (order ? setOrder(null) : shuffle())}>
        <Shuffle size={15} />
      </button>
      <button
        className={"icon-btn" + (hide ? " on" : "")}
        aria-pressed={hide}
        title={hide ? t("dictionary.showAll") : t("dictionary.practice")}
        onClick={() => (setHide(!hide), setRevealed(new Set()))}
      >
        {hide ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </>
  );

  return (
    <ToolWindow title={t("dictionary.title")} icon={<BookA size={16} />} toolbar={toolbar}>
      <div className="dict-table" role="table" aria-label={t("dictionary.title")}>
        <div className="dict-row head" role="row">
          <span role="columnheader">{langName(ui)}</span>
          <span role="columnheader">{langName(target)}</span>
        </div>
        {hide && <p className="hint dict-tip">{t("dictionary.practiceHint")}</p>}
        {shown.map((e) => {
          const covered = hide && !revealed.has(e.key);
          return (
            <div key={e.key} className="dict-row" role="row" title={e.key}>
              <span role="cell">
                <Text value={e.from} lang={ui} />
                {e.plural && <span className="tag-badge">{e.plural}</span>}
              </span>
              <span
                role="cell"
                className={"dict-to" + (covered ? " covered" : "")}
                onClick={() => covered && setRevealed((s) => new Set(s).add(e.key))}
                tabIndex={covered ? 0 : undefined}
                onKeyDown={(k) => covered && (k.key === "Enter" || k.key === " ") && setRevealed((s) => new Set(s).add(e.key))}
              >
                <Text value={e.to} lang={target} />
              </span>
            </div>
          );
        })}
        {!shown.length && <p className="log-empty">{t("dictionary.none")}</p>}
      </div>
    </ToolWindow>
  );
}
