// Shared CodeMirror setup for the file viewer and the diff viewer: theme and
// syntax colors from the theme tokens (never hard-coded), languages loaded on
// demand by file name, and the search/diff texts in the UI language.
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { tags as t } from "@lezer/highlight";
import type { TFunction } from "i18next";

export const codeTheme = EditorView.theme(
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

/** Diff colors (@codemirror/merge), overriding its built-in hex colors with
 *  the theme's ok/danger tokens. Added lines are green, removed ones red, and
 *  the words that changed inside them stronger. */
export const diffTheme = EditorView.theme(
  {
    ".cm-changedLine, .cm-inlineChangedLine": { backgroundColor: "color-mix(in srgb, var(--ok) 11%, transparent)" },
    "&.cm-merge-a .cm-changedLine, .cm-deletedChunk": { backgroundColor: "color-mix(in srgb, var(--danger) 11%, transparent)" },
    // `.cm-line` makes these more specific than the package's own rules
    // (a thin underline in hard-coded colors), which load after this theme.
    ".cm-line .cm-changedText, &.cm-merge-b .cm-line .cm-changedText": { background: "color-mix(in srgb, var(--ok) 24%, transparent)" },
    "&.cm-merge-a .cm-line .cm-changedText, .cm-deletedChunk .cm-line .cm-deletedText, &.cm-merge-b .cm-line .cm-deletedText": {
      background: "color-mix(in srgb, var(--danger) 26%, transparent)",
    },
    // The merge view marks text with <ins>/<del>: no browser underline/strike.
    "ins, del": { textDecoration: "none" },
    ".cm-deletedChunk": { paddingLeft: "0" },
    ".cm-deletedLine": { color: "color-mix(in srgb, var(--danger) 30%, var(--text))" },
    ".cm-changeGutter": { width: "3px", paddingLeft: "1px" },
    ".cm-changedLineGutter": { background: "var(--ok)" },
    "&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter": { background: "var(--danger)" },
    ".cm-collapsedLines": {
      color: "var(--text-muted)",
      background: "var(--bg-raised)",
      borderTop: "1px solid var(--border-subtle)",
      borderBottom: "1px solid var(--border-subtle)",
      fontFamily: "var(--font-ui)",
      cursor: "pointer",
    },
    ".cm-collapsedLines:hover": { color: "var(--text)", background: "var(--bg-hover)" },
    ".cm-collapsedLines:before, .cm-collapsedLines:after": { display: "none" },
  },
  { dark: true },
);

export const codeHighlight = syntaxHighlighting(
  HighlightStyle.define([
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
  ]),
);

/** The language support for a file name, loaded on demand (null if none). */
export async function languageFor(path: string): Promise<Extension | null> {
  const name = path.split("/").pop() ?? path;
  const lang = LanguageDescription.matchFilename(languages, name);
  return lang ? lang.load() : null;
}

/** CodeMirror's own texts (search panel, folded lines…) in the UI language. */
export const phrases = (t: TFunction): Extension => EditorState.phrases.of(t("editor", { returnObjects: true }) as Record<string, string>);
