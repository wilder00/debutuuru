// Diff viewer on @codemirror/merge: unified (one column), split (old left,
// new right) or the whole file with the changes marked. Unchanged runs fold
// to "N unchanged lines" bars that open with a click. Words that changed,
// syntax colors, whitespace and wrapping follow the user's diff settings.
import { goToNextChunk, goToPreviousChunk, MergeView, unifiedMergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { defaultKeymap } from "@codemirror/commands";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { useTranslation } from "react-i18next";
import type { DiffSettings } from "../../bindings/DiffSettings";
import { codeHighlight, codeTheme, diffTheme, languageFor, phrases } from "./codemirror";
import { ignoreWhitespaceDiff } from "./whitespace";

export type DiffNav = { next: () => void; previous: () => void };

type Props = {
  path: string;
  oldText: string;
  newText: string;
  options: DiffSettings;
  /** Next/previous change, for toolbar buttons. */
  ref?: Ref<DiffNav>;
};

/** Alt+↓ / Alt+↑ jump between changes inside the viewer. */
const chunkKeys = keymap.of([
  { key: "Alt-ArrowDown", run: goToNextChunk },
  { key: "Alt-ArrowUp", run: goToPreviousChunk },
]);

export function DiffViewer({ path, oldText, newText, options, ref }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const active = useRef<EditorView | null>(null);
  const { t, i18n } = useTranslation();

  useImperativeHandle(ref, () => ({
    next: () => {
      const v = active.current;
      if (v) goToNextChunk(v), v.focus();
    },
    previous: () => {
      const v = active.current;
      if (v) goToPreviousChunk(v), v.focus();
    },
  }));

  useEffect(() => {
    const parent = host.current!;
    let stale = false;
    let destroy = () => {};

    const build = (lang: Extension | null) => {
      const ext: Extension[] = [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        lineNumbers(),
        highlightSpecialChars(),
        drawSelection(),
        highlightSelectionMatches(),
        search({ top: true }),
        keymap.of([...searchKeymap, ...defaultKeymap]),
        chunkKeys,
        codeTheme,
        diffTheme,
        phrases(t),
      ];
      if (options.syntax_highlight) ext.push(codeHighlight, lang ?? []);
      if (options.wrap_lines) ext.push(EditorView.lineWrapping);
      const collapse =
        options.layout === "file" ? undefined : { margin: options.context_lines, minSize: Math.max(4, options.context_lines) };
      const diffConfig = options.ignore_whitespace ? { override: ignoreWhitespaceDiff } : undefined;

      if (options.layout === "split") {
        const mv = new MergeView({
          a: { doc: oldText, extensions: ext },
          b: { doc: newText, extensions: ext },
          parent,
          gutter: true,
          highlightChanges: options.word_highlight,
          collapseUnchanged: collapse,
          diffConfig,
        });
        active.current = mv.b;
        destroy = () => mv.destroy();
      } else {
        const v = new EditorView({
          parent,
          state: EditorState.create({
            doc: newText,
            extensions: [
              ext,
              unifiedMergeView({
                original: oldText,
                gutter: true,
                highlightChanges: options.word_highlight,
                syntaxHighlightDeletions: options.syntax_highlight,
                mergeControls: false,
                collapseUnchanged: collapse,
                diffConfig,
              }),
            ],
          }),
        });
        active.current = v;
        destroy = () => v.destroy();
      }
    };

    // Draw right away, then again with syntax colors once the language loads
    // (scroll is kept: it's the same content).
    build(null);
    if (options.syntax_highlight) {
      languageFor(path)
        .then((lang) => {
          if (stale || !lang) return;
          const top = parent.querySelector(".cm-scroller")?.scrollTop ?? 0;
          destroy();
          build(lang);
          parent.querySelectorAll(".cm-scroller").forEach((s) => (s.scrollTop = top));
        })
        .catch(() => {});
    }
    return () => {
      stale = true;
      destroy();
      active.current = null;
    };
    // Rebuild for new content, options or UI language (folded-lines text).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, oldText, newText, options, i18n.language]);

  return <div className={"diff-viewer" + (options.layout === "split" ? " split" : "")} ref={host} />;
}
