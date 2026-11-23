// Ctrl+click (Cmd on macOS) like in VS Code: on an import it opens the
// imported file; on a name (function, variable, type…) it goes to where it's
// defined. Imports are marked once per document; the name under the mouse is
// marked while it moves. Both look like links only while Ctrl is held.
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { nameAt, type Rules, type Sym } from "./definitions";
import type { Link } from "./links";

/** Adds `cm-ctrl-held` to the editor while Ctrl/Cmd is down. */
const ctrlTracker = ViewPlugin.define((view) => {
  const set = (on: boolean) => view.dom.classList.toggle("cm-ctrl-held", on);
  const key = (e: KeyboardEvent) => set(e.ctrlKey || e.metaKey);
  const move = (e: MouseEvent) => set(e.ctrlKey || e.metaKey);
  const off = () => set(false);
  window.addEventListener("keydown", key);
  window.addEventListener("keyup", key);
  window.addEventListener("blur", off);
  view.dom.addEventListener("mousemove", move);
  return {
    destroy() {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", off);
      view.dom.removeEventListener("mousemove", move);
    },
  };
});

/** Comments and strings hold words, not names. */
const inText = (state: EditorState, pos: number) => {
  const node = syntaxTree(state).resolveInner(pos, 1);
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (/Comment|String|Regexp|Docstring/.test(n.name)) return true;
  }
  return false;
};

/** The name under the mouse, only when it's really over its letters. */
function symbolAt(view: EditorView, rules: Rules, x: number, y: number): Sym | null {
  const pos = view.posAtCoords({ x, y });
  if (pos === null) return null;
  const line = view.state.doc.lineAt(pos);
  const sym = nameAt(rules, line.text, line.from, line.number, pos);
  if (!sym) return null;
  const a = view.coordsAtPos(sym.from);
  const b = view.coordsAtPos(sym.to, -1);
  if (!a || !b || x < a.left || x > b.right || y < a.top || y > a.bottom) return null;
  return inText(view.state, sym.from) ? null : sym;
}

const setHover = StateEffect.define<{ from: number; to: number } | null>();

function hoverField(title: string) {
  const mark = Decoration.mark({ class: "cm-symbol-link", attributes: { title } });
  return StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
      for (const e of tr.effects) if (e.is(setHover)) return e.value ? Decoration.set([mark.range(e.value.from, e.value.to)]) : Decoration.none;
      return deco.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

type Options = {
  links: Link[];
  onFollow: (link: Link) => void;
  linkTitle: string;
  /** Names: how to find them and what a Ctrl+click on one does. */
  names?: { rules: Rules; onDefine: (sym: Sym) => void; title: string } | null;
};

export function importLinks({ links, onFollow, linkTitle, names }: Options): Extension {
  if (!links.length && !names) return [];
  const linkAt = (pos: number) => links.find((l) => pos >= l.from && pos <= l.to);
  const mark = Decoration.mark({ class: "cm-import-link", attributes: { title: linkTitle } });
  const field = names ? hoverField(names.title) : null;
  let hovered: string | null = null;
  return [
    links.length ? EditorView.decorations.of(Decoration.set(links.map((l) => mark.range(l.from, l.to)))) : [],
    field ?? [],
    ctrlTracker,
    EditorView.domEventHandlers({
      mousemove(e, view) {
        if (!names) return false;
        const sym = e.ctrlKey || e.metaKey ? symbolAt(view, names.rules, e.clientX, e.clientY) : null;
        const pos = sym ? (linkAt(sym.from) ? null : sym) : null;
        const key = pos ? `${pos.from}:${pos.to}` : null;
        if (key !== hovered) {
          hovered = key;
          view.dispatch({ effects: setHover.of(pos && { from: pos.from, to: pos.to }) });
        }
        return false;
      },
      mousedown(e, view) {
        if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        const link = pos === null ? undefined : linkAt(pos);
        if (link) {
          e.preventDefault();
          onFollow(link);
          return true;
        }
        const sym = names && symbolAt(view, names.rules, e.clientX, e.clientY);
        if (!sym) return false;
        e.preventDefault();
        names.onDefine(sym);
        return true;
      },
    }),
  ];
}
