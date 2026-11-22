// Read-only code viewer (CodeMirror 6): renders only the visible lines, so
// large files stay fast. Line numbers, Ctrl+F search, syntax colors from the
// theme's --syn-* tokens, and languages loaded on demand by file name.
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { defaultKeymap } from "@codemirror/commands";
import { tags as t } from "@lezer/highlight";

const theme = EditorView.theme(
  {
    "&": { height: "100%", color: "var(--text)", backgroundColor: "transparent", fontSize: "0.92em" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55", fontVariantLigatures: "var(--code-ligatures)" },
    ".cm-content": { caretColor: "var(--accent)", padding: "4px 0" },
    ".cm-cursor": { borderLeftColor: "var(--accent)" },
    ".cm-gutters": { backgroundColor: "transparent", color: "var(--text-faint)", border: "none" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 16px" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--accent-soft)" },
    ".cm-selectionMatch": { backgroundColor: "var(--bg-active)" },
    ".cm-searchMatch": { backgroundColor: "var(--accent-soft)", outline: "1px solid var(--accent-ring)" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--accent-ring)" },
    ".cm-panels": { backgroundColor: "var(--bg-solid)", color: "var(--text)", borderTop: "1px solid var(--border)" },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
    ".cm-search": { fontFamily: "var(--font-ui)", fontSize: "0.92em", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", padding: "6px 10px" },
    ".cm-search input, .cm-search button": { height: "26px", margin: "0", fontSize: "inherit" },
    "& .cm-panels .cm-search .cm-button": {
      backgroundImage: "none",
      backgroundColor: "var(--bg-raised)",
      color: "var(--text)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius)",
      padding: "0 10px",
      cursor: "pointer",
    },
    "& .cm-panels .cm-search .cm-button:hover": { backgroundColor: "var(--bg-hover)", borderColor: "var(--border-strong)" },
    "& .cm-panels .cm-search .cm-textfield": {
      backgroundColor: "var(--bg-raised)",
      color: "var(--text)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius)",
      padding: "0 8px",
    },
    "& .cm-panels .cm-search .cm-textfield:focus": { outline: "none", borderColor: "var(--accent)", boxShadow: "0 0 0 2px var(--accent-soft)" },
    ".cm-search label": { display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--text-muted)" },
    ".cm-search [name=close]": { marginLeft: "auto", background: "none", border: "0", color: "var(--text-muted)", cursor: "pointer" },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: "var(--syn-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: "var(--syn-string)" },
  { tag: [t.number, t.integer, t.float], color: "var(--syn-number)" },
  { tag: [t.bool, t.null, t.atom, t.constant(t.variableName), t.standard(t.variableName)], color: "var(--syn-constant)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: "var(--syn-function)" },
  { tag: [t.typeName, t.className, t.namespace, t.tagName, t.self], color: "var(--syn-type)" },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: "var(--syn-property)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [t.heading], color: "var(--syn-function)", fontWeight: "700" },
  { tag: [t.link, t.url], color: "var(--syn-string)", textDecoration: "underline" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.strong], fontWeight: "700" },
  { tag: [t.meta, t.processingInstruction], color: "var(--text-muted)" },
  { tag: [t.invalid], color: "var(--danger)" },
]);

/** Holds the file's language; swapped without resetting scroll or selection. */
const language = new Compartment();
/** The search panel's texts ("Find", "match case"…) in the UI language. */
const phrases = new Compartment();

const base: Extension = [
  language.of([]),
  phrases.of([]),
  EditorState.readOnly.of(true),
  lineNumbers(),
  highlightSpecialChars(),
  drawSelection(),
  highlightSelectionMatches(),
  search({ top: true }),
  keymap.of([...searchKeymap, ...defaultKeymap]),
  syntaxHighlighting(highlight),
  theme,
];

export function CodeViewer({ path, text }: { path: string; text: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const { t, i18n } = useTranslation();
  const phraseExt = () => EditorState.phrases.of(t("editor", { returnObjects: true }));

  useEffect(() => {
    const v = new EditorView({ parent: host.current!, state: EditorState.create({ extensions: base }) });
    view.current = v;
    return () => v.destroy();
  }, []);

  // New file: fresh state (resets scroll, selection and search), then the
  // language once its parser has loaded.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.setState(EditorState.create({ doc: text, extensions: base }));
    v.dispatch({ effects: phrases.reconfigure(phraseExt()) });
    const name = path.split("/").pop() ?? path;
    const lang = LanguageDescription.matchFilename(languages, name);
    let stale = false;
    lang
      ?.load()
      .then((support) => {
        if (!stale) v.dispatch({ effects: language.reconfigure(support) });
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [path, text]);

  // UI language changed: retranslate an open search panel too.
  useEffect(() => {
    view.current?.dispatch({ effects: phrases.reconfigure(phraseExt()) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.language]);

  return <div className="code-viewer" ref={host} />;
}
