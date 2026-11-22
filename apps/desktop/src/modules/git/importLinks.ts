// Ctrl+click (Cmd on macOS) on an import opens the imported file, like in
// VS Code: imports are marked once per document, look like links only while
// Ctrl is held, and a Ctrl+click on one calls `onFollow`.
import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
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

export function importLinks(links: Link[], onFollow: (link: Link) => void, title: string): Extension {
  if (!links.length) return [];
  const mark = Decoration.mark({ class: "cm-import-link", attributes: { title } });
  const set = Decoration.set(links.map((l) => mark.range(l.from, l.to)));
  return [
    EditorView.decorations.of(set),
    ctrlTracker,
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        const link = pos === null ? undefined : links.find((l) => pos >= l.from && pos <= l.to);
        if (!link) return false;
        e.preventDefault();
        onFollow(link);
        return true;
      },
    }),
  ];
}
