// Read-only code viewer (CodeMirror 6): renders only the visible lines, so
// large files stay fast. Line numbers, Ctrl+F search, syntax colors from the
// theme's --syn-* tokens, and languages loaded on demand by file name.
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, drawSelection, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { defaultKeymap } from "@codemirror/commands";
import { codeHighlight, codeTheme, languageFor, phrases } from "./codemirror";
import { rulesFor, type Sym } from "./definitions";
import { importLinks } from "./importLinks";
import { findLinks, langOf, type Link } from "./links";

/** Holds the file's language; swapped without resetting scroll or selection. */
const language = new Compartment();
/** The search panel's texts ("Find", "match case"…) in the UI language. */
const texts = new Compartment();
/** Ctrl+click on imports and names, rebuilt for each file. */
const links = new Compartment();
/** The line jumped to (a definition), marked. */
const target = new Compartment();

const base: Extension = [
  language.of([]),
  texts.of([]),
  links.of([]),
  target.of([]),
  EditorState.readOnly.of(true),
  lineNumbers(),
  highlightSpecialChars(),
  drawSelection(),
  highlightSelectionMatches(),
  search({ top: true }),
  keymap.of([...searchKeymap, ...defaultKeymap]),
  codeHighlight,
  codeTheme,
];

type Props = {
  path: string;
  text: string;
  /** Ctrl+click on an import or link; without it nothing is clickable. */
  onFollow?: (link: Link) => void;
  /** Ctrl+click on a name (function, variable…): go to its definition. */
  onDefine?: (sym: Sym) => void;
  /** Line to show and mark (1-based); a new `key` jumps again. */
  goto?: { line: number; key: number } | null;
};

export function CodeViewer({ path, text, onFollow, onDefine, goto }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const { t, i18n } = useTranslation();
  // Latest callback without rebuilding the editor state on every render.
  const follow = useRef(onFollow);
  follow.current = onFollow;
  const define = useRef(onDefine);
  define.current = onDefine;

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
    v.dispatch({
      effects: [
        texts.reconfigure(phrases(t)),
        links.reconfigure(linksFor(path, text)),
      ],
    });
    let stale = false;
    languageFor(path)
      .then((support) => {
        if (!stale && support) v.dispatch({ effects: language.reconfigure(support) });
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, text]);

  // Jump to a line: centered, marked, with the cursor at its start.
  useEffect(() => {
    const v = view.current;
    if (!v || !goto || goto.line > v.state.doc.lines) return;
    const l = v.state.doc.line(goto.line);
    v.dispatch({
      selection: { anchor: l.from },
      effects: [EditorView.scrollIntoView(l.from, { y: "center" }), target.reconfigure(EditorView.decorations.of(Decoration.set([Decoration.line({ class: "cm-target-line" }).range(l.from)])))],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goto?.key, text]);

  function linksFor(path: string, text: string) {
    if (!onFollow) return [];
    const rules = onDefine ? rulesFor(path, langOf(path)) : null;
    return importLinks({
      links: findLinks(path, text),
      onFollow: (l) => follow.current?.(l),
      linkTitle: t("git.filesView.followLink"),
      names: rules && { rules, onDefine: (s) => define.current?.(s), title: t("git.filesView.definition.hint") },
    });
  }

  // UI language changed: retranslate an open search panel too.
  useEffect(() => {
    view.current?.dispatch({ effects: texts.reconfigure(phrases(t)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.language]);

  return <div className="code-viewer" ref={host} />;
}
