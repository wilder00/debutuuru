// Files: the repository's file tree and a read-only viewer, for the working
// tree (with live changes marked) or for any commit.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, File, FileSymlink, Folder, FolderGit2, FolderOpen, Loader2 } from "lucide-react";
import type { FileContent } from "../../bindings/FileContent";
import type { Snapshot } from "../../bindings/Snapshot";
import type { TreeEntry } from "../../bindings/TreeEntry";
import { formatBytes } from "../../lib/format";
import { git } from "./api";
import { CodeViewer } from "./CodeViewer";

type Props = {
  repo: string;
  snapshot: Snapshot;
  /** Commit to browse; null = working tree. */
  rev: string | null;
  /** Commits offered in the picker besides the working tree. */
  revOptions: { value: string; label: string }[];
  onRev: (rev: string | null) => void;
};

const STATUS_NAME: Record<string, string> = { M: "modified", A: "added", D: "deleted", R: "renamed", C: "copied", "?": "untracked", U: "conflict" };

type Dir = TreeEntry[] | "loading" | { error: string };

export function FilesView({ repo, snapshot, rev, revOptions, onRev }: Props) {
  const [showIgnored, setShowIgnored] = useState(false);
  const [dirs, setDirs] = useState<Map<string, Dir>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<FileContent | { error: string } | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (path: string, quiet = false) => {
      if (!quiet) setDirs((m) => new Map(m).set(path, "loading"));
      try {
        const entries = await git.tree(repo, { rev: rev ?? undefined, path, show_ignored: showIgnored });
        setDirs((m) => new Map(m).set(path, entries));
      } catch (e) {
        setDirs((m) => new Map(m).set(path, { error: e instanceof Error ? e.message : String(e) }));
      }
    },
    [repo, rev, showIgnored],
  );

  // New revision or ignored toggle: start again from the root, keeping the
  // open folders that still exist.
  useEffect(() => {
    setDirs(new Map());
    void load("");
    expanded.forEach((d) => void load(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // Working tree: every repo change (the agent's watcher reloads the
  // snapshot) refreshes the open folders and the open file, without flicker.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (rev !== null) return;
    void load("", true);
    expanded.forEach((d) => void load(d, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  useEffect(() => {
    if (!selected) return;
    let stale = false;
    git
      .readFile(repo, { rev: rev ?? undefined, path: selected })
      .then((c) => !stale && setContent(c))
      .catch((e) => !stale && setContent({ error: e instanceof Error ? e.message : String(e) }));
    return () => {
      stale = true;
    };
  }, [repo, rev, selected, rev === null ? snapshot : null]);

  // Git status letter per changed path (working tree only), and the folders
  // that contain changes.
  const changes = useMemo(() => {
    const files = new Map<string, string>();
    const folders = new Set<string>();
    if (rev !== null) return { files, folders };
    for (const f of snapshot.status.files) {
      // Same letters as the Changes panel: "?" = untracked (shown as U, green).
      const letter = f.worktree !== " " ? f.worktree : f.index;
      files.set(f.path, letter);
      const parts = f.path.split("/");
      for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"));
    }
    return { files, folders };
  }, [snapshot, rev]);

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

  // Arrow keys move through visible rows; Right/Left open/close folders.
  const onKey = (ev: React.KeyboardEvent) => {
    const i = rows.findIndex((r) => r.entry.path === selected);
    const cur = rows[i]?.entry;
    const go = (j: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, j))];
      if (!r) return;
      setSelected(r.entry.path);
      treeRef.current?.querySelector(`[data-path="${CSS.escape(r.entry.path)}"]`)?.scrollIntoView({ block: "nearest" });
    };
    if (ev.key === "ArrowDown") go(i + 1);
    else if (ev.key === "ArrowUp") go(i - 1);
    else if (cur?.kind === "dir" && ((ev.key === "ArrowRight" && !expanded.has(cur.path)) || (ev.key === "ArrowLeft" && expanded.has(cur.path)) || ev.key === "Enter")) toggle(cur);
    else if (ev.key === "ArrowLeft" && cur) {
      const parent = cur.path.split("/").slice(0, -1).join("/");
      if (parent) go(rows.findIndex((r) => r.entry.path === parent));
    } else return;
    ev.preventDefault();
  };

  const root = dirs.get("");
  const selectedIsFile = selected !== null && rows.find((r) => r.entry.path === selected)?.entry.kind !== "dir";
  // The open file was deleted (or doesn't exist at this commit): its folder is
  // loaded and no longer lists it.
  const parent = dirs.get(selected?.split("/").slice(0, -1).join("/") ?? "");
  const gone = selected !== null && Array.isArray(parent) && !parent.some((e) => e.path === selected);

  return (
    <div className="files-view">
      <div className="files-tree">
        <div className="files-head">
          <select className="rev-select" value={rev ?? ""} onChange={(e) => onRev(e.target.value || null)} title="Which version of the files to show">
            <option value="">Working tree</option>
            {revOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {rev === null && (
            <label className="check ignored-toggle" title="Show files matched by .gitignore">
              <input type="checkbox" checked={showIgnored} onChange={(e) => setShowIgnored(e.target.checked)} />
              Ignored
            </label>
          )}
        </div>
        <div className="files-rows" ref={treeRef} tabIndex={0} onKeyDown={onKey} role="tree" aria-label="Files">
          {root === "loading" && <div className="empty-line">Loading…</div>}
          {root && !Array.isArray(root) && root !== "loading" && <div className="empty-line danger">{root.error}</div>}
          {rows.map(({ entry, depth }) => {
            const open = expanded.has(entry.path);
            const status = changes.files.get(entry.path);
            const d = dirs.get(entry.path);
            return (
              <div
                key={entry.path}
                data-path={entry.path}
                role="treeitem"
                aria-expanded={entry.kind === "dir" ? open : undefined}
                aria-selected={selected === entry.path}
                className={"item tree-row" + (selected === entry.path ? " selected" : "") + (entry.ignored ? " ignored" : "")}
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => {
                  setSelected(entry.path);
                  toggle(entry);
                }}
                title={entry.path}
              >
                <span className={"chev" + (open ? " open" : "")}>{entry.kind === "dir" && (d === "loading" ? <Loader2 size={12} className="spin" /> : <ChevronRight size={12} />)}</span>
                <EntryIcon entry={entry} open={open} />
                <span className="label">{entry.name}</span>
                {status ? (
                  <span className={"status s-" + (status === "?" ? "q" : status)} title={STATUS_NAME[status] ?? status}>
                    {status === "?" ? "U" : status}
                  </span>
                ) : (
                  changes.folders.has(entry.path) && <span className="change-dot" title="Contains changes" />
                )}
              </div>
            );
          })}
          {Array.isArray(root) && root.length === 0 && <div className="empty-line">No files</div>}
        </div>
      </div>
      <div className="files-content">
        {gone ? (
          <div className="empty">
            <span>
              <code className="mono">{selected}</code> {rev ? "doesn’t exist at this commit" : "no longer exists"}
            </span>
          </div>
        ) : selectedIsFile && selected ? (
          <FilePane path={selected} content={content} rev={rev} />
        ) : (
          <div className="empty">Select a file to see its content</div>
        )}
      </div>
    </div>
  );
}

function EntryIcon({ entry, open }: { entry: TreeEntry; open: boolean }) {
  const size = 14;
  if (entry.kind === "dir") return open ? <FolderOpen size={size} className="ficon dir" /> : <Folder size={size} className="ficon dir" />;
  if (entry.kind === "submodule") return <FolderGit2 size={size} className="ficon dir" />;
  if (entry.kind === "symlink") return <FileSymlink size={size} className="ficon" />;
  return <File size={size} className="ficon" />;
}

function FilePane({ path, content, rev }: { path: string; content: FileContent | { error: string } | null; rev: string | null }) {
  const c = content && "path" in content && content.path === path ? content : null;
  const err = content && "error" in content ? content.error : null;
  return (
    <div className="file-pane">
      <div className="diff-head">
        <span className="path mono">{path}</span>
        {c && <span className="hint">{formatBytes(c.size)}</span>}
        {rev && <span className="hint mono">@ {rev.slice(0, 8)}</span>}
      </div>
      {err ? (
        <div className="empty danger">{err}</div>
      ) : !c ? (
        <div className="empty">Loading…</div>
      ) : c.link_target !== null ? (
        <div className="empty">
          Symbolic link to <code className="mono">{c.link_target}</code>
        </div>
      ) : c.binary ? (
        <div className="empty">Binary file ({formatBytes(c.size)}), not shown</div>
      ) : (
        <>
          {c.truncated && <div className="banner warn">Large file: showing the first {formatBytes(c.text?.length ?? 0)} of {formatBytes(c.size)}.</div>}
          <CodeViewer path={path} text={c.text ?? ""} />
        </>
      )}
    </div>
  );
}
