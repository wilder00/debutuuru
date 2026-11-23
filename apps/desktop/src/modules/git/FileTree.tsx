// The file tree shared by Files (a repository) and the Folder tab (a plain
// folder): folders load one level at a time, arrow keys move through it,
// Back returns to files opened before following links, and files marked as
// favorites are listed on top.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, FileSymlink, FolderGit2, Loader2, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TreeEntry } from "../../bindings/TreeEntry";
import { useSettings } from "../../settings/SettingsProvider";
import { FileIcon } from "./fileIcons";

type Dir = TreeEntry[] | "loading" | { error: string };

const parentsOf = (p: string) =>
  p
    .split("/")
    .slice(0, -1)
    .map((_, i, parts) => parts.slice(0, i + 1).join("/"));

/** State of a tree whose folders come from `list` (stable: a new `list`
 *  starts again from the root, keeping the open folders). */
export function useFileTree(list: (dir: string) => Promise<TreeEntry[]>) {
  const [dirs, setDirs] = useState<Map<string, Dir>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  /** Files opened before following links, for Back. */
  const [history, setHistory] = useState<string[]>([]);

  const load = useCallback(
    async (path: string, quiet = false) => {
      if (!quiet) setDirs((m) => new Map(m).set(path, "loading"));
      try {
        const entries = await list(path);
        setDirs((m) => new Map(m).set(path, entries));
      } catch (e) {
        setDirs((m) => new Map(m).set(path, { error: e instanceof Error ? e.message : String(e) }));
      }
    },
    [list],
  );

  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  useEffect(() => {
    setDirs(new Map());
    void load("");
    expandedRef.current.forEach((d) => void load(d));
  }, [load]);

  /** Reads the root and the open folders again, without flicker. */
  const refresh = useCallback(() => {
    void load("", true);
    expandedRef.current.forEach((d) => void load(d, true));
  }, [load]);

  const rows = useMemo(() => {
    const out: { entry: TreeEntry; depth: number }[] = [];
    const walk = (path: string, depth: number) => {
      const d = dirs.get(path);
      if (!Array.isArray(d)) return;
      for (const entry of d) {
        out.push({ entry, depth });
        if (entry.kind === "dir" && expanded.has(entry.path)) walk(entry.path, depth + 1);
      }
    };
    walk("", 0);
    return out;
  }, [dirs, expanded]);

  /** Shows `path` in the tree (opening its folders) and selects it. */
  const reveal = useCallback(
    async (path: string, isDir: boolean) => {
      const parents = parentsOf(path);
      await Promise.all(["", ...parents].filter((d) => !Array.isArray(dirs.get(d))).map((d) => load(d, true)));
      if (isDir) await load(path, true);
      setExpanded((s) => new Set([...s, ...parents, ...(isDir ? [path] : [])]));
      setSelected(path);
    },
    [dirs, load],
  );

  /** Opens `path` and remembers the current file for Back. */
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const go = useCallback(
    (path: string, isDir = false) => {
      const cur = selectedRef.current;
      if (cur && cur !== path) setHistory((h) => [...h.slice(-49), cur]);
      void reveal(path, isDir);
    },
    [reveal],
  );

  const back = useCallback(() => {
    const prev = history[history.length - 1];
    if (prev === undefined) return;
    setHistory((h) => h.slice(0, -1));
    void reveal(prev, false);
  }, [history, reveal]);

  const toggle = (e: TreeEntry) => {
    if (e.kind !== "dir") {
      setSelected(e.path);
      return;
    }
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(e.path)) next.delete(e.path);
      else {
        next.add(e.path);
        if (!Array.isArray(dirs.get(e.path))) void load(e.path);
      }
      return next;
    });
  };

  const root = dirs.get("");
  const selectedEntry = selected === null ? undefined : rows.find((r) => r.entry.path === selected)?.entry;
  // The open file was deleted (or doesn't exist at this commit): its folder
  // is loaded and no longer lists it.
  const parent = dirs.get(selected?.split("/").slice(0, -1).join("/") ?? "");
  const gone = selected !== null && Array.isArray(parent) && !parent.some((e) => e.path === selected);

  return { dirs, root, rows, expanded, selected, selectedEntry, gone, setSelected, toggle, reveal, go, back, canGoBack: history.length > 0, refresh };
}

export type FileTreeState = ReturnType<typeof useFileTree>;

/** Favorites of one tab (a repository or a folder), kept in the session. */
export function useBookmarks(tab: string) {
  const { session, updateSession } = useSettings();
  const list = useMemo(() => session.bookmarks?.[tab] ?? [], [session.bookmarks, tab]);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const toggle = useCallback(
    (path: string) => {
      const s = sessionRef.current;
      const cur = s.bookmarks?.[tab] ?? [];
      const next = cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path];
      const bookmarks = { ...s.bookmarks };
      if (next.length) bookmarks[tab] = next;
      else delete bookmarks[tab];
      updateSession({ ...s, bookmarks });
    },
    [tab, updateSession],
  );
  return { list, has: (path: string) => list.includes(path), toggle };
}

export type Bookmarks = ReturnType<typeof useBookmarks>;

export function EntryIcon({ entry, open }: { entry: TreeEntry; open: boolean }) {
  if (entry.kind === "submodule") return <FolderGit2 size={14} className="ficon dir" />;
  if (entry.kind === "symlink") return <FileSymlink size={14} className="ficon" />;
  return <FileIcon name={entry.name} folder={entry.kind === "dir"} open={open} />;
}

/** Star that marks a file as a favorite (or unmarks it). */
export function BookmarkButton({ on, onToggle, className = "" }: { on: boolean; onToggle: () => void; className?: string }) {
  const { t } = useTranslation();
  return (
    <button
      className={"icon-btn bookmark-btn" + (on ? " on" : "") + (className ? " " + className : "")}
      aria-pressed={on}
      title={on ? t("files.bookmarks.remove") : t("files.bookmarks.add")}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <Star size={13} />
    </button>
  );
}

type RowsProps = {
  tree: FileTreeState;
  label: string;
  bookmarks: Bookmarks;
  /** Status letter, change dot… after the name. */
  trailing?: (entry: TreeEntry) => ReactNode;
  /** Messages under the favorites when the root is empty. */
  empty: string;
};

/** The tree's rows with keyboard navigation, and the favorites above them. */
export function FileTreeRows({ tree, label, bookmarks, trailing, empty }: RowsProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const { rows, expanded, selected, dirs, root } = tree;

  // Keep the selected row visible (keyboard, Back, followed links).
  useEffect(() => {
    if (selected) ref.current?.querySelector(`.tree-row[data-path="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected, rows]);

  // Arrow keys move through visible rows; Right/Left open/close folders.
  const onKey = (ev: React.KeyboardEvent) => {
    const i = rows.findIndex((r) => r.entry.path === selected);
    const cur = rows[i]?.entry;
    const go = (j: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, j))];
      if (r) tree.setSelected(r.entry.path);
    };
    if (ev.key === "ArrowDown") go(i + 1);
    else if (ev.key === "ArrowUp") go(i - 1);
    else if (cur?.kind === "dir" && ((ev.key === "ArrowRight" && !expanded.has(cur.path)) || (ev.key === "ArrowLeft" && expanded.has(cur.path)) || ev.key === "Enter")) tree.toggle(cur);
    else if (ev.key === "ArrowLeft" && cur) {
      const parent = cur.path.split("/").slice(0, -1).join("/");
      if (parent) go(rows.findIndex((r) => r.entry.path === parent));
    } else return;
    ev.preventDefault();
  };

  return (
    <div className="files-rows" ref={ref} tabIndex={0} onKeyDown={onKey} role="tree" aria-label={label}>
      {bookmarks.list.length > 0 && (
        <div className="bookmarks" role="group" aria-label={t("files.bookmarks.title")}>
          <div className="bookmarks-title">
            <Star size={11} /> {t("files.bookmarks.title")}
          </div>
          {bookmarks.list.map((p) => {
            const name = p.split("/").pop() ?? p;
            const dir = p.slice(0, Math.max(0, p.length - name.length - 1));
            return (
              <div key={p} className={"item bookmark-row" + (selected === p ? " selected" : "")} title={p} onClick={() => tree.go(p)}>
                <FileIcon name={name} folder={false} open={false} />
                <span className="label">{name}</span>
                {dir && <span className="hint bookmark-dir">{dir}</span>}
                <BookmarkButton on onToggle={() => bookmarks.toggle(p)} className="shown" />
              </div>
            );
          })}
        </div>
      )}
      {root === "loading" && <div className="empty-line">{t("common.loading")}</div>}
      {root && !Array.isArray(root) && root !== "loading" && <div className="empty-line danger">{root.error}</div>}
      {rows.map(({ entry, depth }) => {
        const open = expanded.has(entry.path);
        const d = dirs.get(entry.path);
        const marked = bookmarks.has(entry.path);
        return (
          <div
            key={entry.path}
            data-path={entry.path}
            role="treeitem"
            aria-expanded={entry.kind === "dir" ? open : undefined}
            aria-selected={selected === entry.path}
            className={"item tree-row" + (selected === entry.path ? " selected" : "") + (entry.ignored ? " ignored" : "") + (marked ? " bookmarked" : "")}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => {
              tree.setSelected(entry.path);
              tree.toggle(entry);
            }}
            title={entry.path}
          >
            <span className={"chev" + (open ? " open" : "")}>{entry.kind === "dir" && (d === "loading" ? <Loader2 size={12} className="spin" /> : <ChevronRight size={12} />)}</span>
            <EntryIcon entry={entry} open={open} />
            <span className="label">{entry.name}</span>
            {trailing?.(entry)}
            {entry.kind === "file" && <BookmarkButton on={marked} onToggle={() => bookmarks.toggle(entry.path)} />}
          </div>
        );
      })}
      {Array.isArray(root) && root.length === 0 && <div className="empty-line">{empty}</div>}
    </div>
  );
}
