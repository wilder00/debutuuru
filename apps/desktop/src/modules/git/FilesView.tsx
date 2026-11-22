// Files: the repository's file tree and a read-only viewer, for the working
// tree (with live changes marked) or for any commit. Ctrl+click on an import
// opens the imported file; Markdown is shown rendered by default.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, File, FileDiff, FileSymlink, Folder, FolderGit2, FolderOpen, Loader2 } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import type { FileContent } from "../../bindings/FileContent";
import type { Snapshot } from "../../bindings/Snapshot";
import type { TreeEntry } from "../../bindings/TreeEntry";
import { formatBytes } from "../../lib/format";
import { git } from "./api";
import { CodeViewer } from "./CodeViewer";
import { FileChanges } from "./FileChanges";
import { candidates, langOf, type Link } from "./links";
import { statusName } from "./status";

type Props = {
  repo: string;
  snapshot: Snapshot;
  /** Commit to browse; null = working tree. */
  rev: string | null;
  /** Commits offered in the picker besides the working tree. */
  revOptions: { value: string; label: string }[];
  onRev: (rev: string | null) => void;
  /** Quick open (Ctrl+P): reveal this file; `n` changes on every request. */
  openRequest?: { path: string; n: number } | null;
};


type Dir = TreeEntry[] | "loading" | { error: string };

// Rendered Markdown (react-markdown, KaTeX…) loads the first time it's shown.
const MarkdownView = lazy(() => import("./MarkdownView").then((m) => ({ default: m.MarkdownView })));

const parentsOf = (p: string) => p.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"));

export function FilesView({ repo, snapshot, rev, revOptions, onRev, openRequest }: Props) {
  const { t } = useTranslation();
  const [showIgnored, setShowIgnored] = useState(false);
  const [dirs, setDirs] = useState<Map<string, Dir>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<FileContent | { error: string } | null>(null);
  /** Files opened before following links, for Back. */
  const [history, setHistory] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  /** "Changes" instead of the content; stays on while moving between files. */
  const [showChanges, setShowChanges] = useState(false);
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

  // Shows `path` in the tree (opening its folders) and selects it.
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

  // Ctrl+click on an import / a link: the first candidate that exists.
  const follow = useCallback(
    async (link: Link) => {
      const from = selected ?? "";
      setNotice(null);
      const read = (p: string) =>
        git
          .readFile(repo, { rev: rev ?? undefined, path: p })
          .then((c) => c.text ?? null)
          .catch(() => null);
      try {
        const paths = await candidates(link, from, { read });
        for (let i = 0; i < paths.length; i += 64) {
          const chunk = paths.slice(i, i + 64);
          const kinds = await git.statPaths(repo, { rev: rev ?? undefined, paths: chunk });
          const k = kinds.findIndex((kind) => kind !== null);
          if (k >= 0) {
            if (chunk[k] !== from) setHistory((h) => [...h.slice(-49), from]);
            await reveal(chunk[k], kinds[k] === "dir" || kinds[k] === "submodule");
            return;
          }
        }
        setNotice(t("git.filesView.linkNotFound", { spec: link.spec }));
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      }
    },
    [repo, rev, selected, reveal, t],
  );

  useEffect(() => {
    if (!openRequest) return;
    if (selected && selected !== openRequest.path) setHistory((h) => [...h.slice(-49), selected]);
    void reveal(openRequest.path, false);
    // Only for a new request, not when `reveal` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  const back = useCallback(() => {
    const prev = history[history.length - 1];
    if (prev === undefined) return;
    setHistory((h) => h.slice(0, -1));
    void reveal(prev, false);
  }, [history, reveal]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(id);
  }, [notice]);

  // Keep the selected row visible (keyboard, Back, followed links).
  useEffect(() => {
    if (selected) treeRef.current?.querySelector(`[data-path="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected, rows]);

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
    <div className="files-view" onKeyDown={(e) => e.altKey && e.key === "ArrowLeft" && (e.preventDefault(), back())}>
      <div className="files-tree">
        <div className="files-head">
          <select className="rev-select" value={rev ?? ""} onChange={(e) => onRev(e.target.value || null)} title={t("git.filesView.revision")}>
            <option value="">{t("git.filesView.workingTree")}</option>
            {revOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {rev === null && (
            <label className="check ignored-toggle" title={t("git.filesView.ignoredHint")}>
              <input type="checkbox" checked={showIgnored} onChange={(e) => setShowIgnored(e.target.checked)} />
              {t("git.filesView.ignored")}
            </label>
          )}
        </div>
        <div className="files-rows" ref={treeRef} tabIndex={0} onKeyDown={onKey} role="tree" aria-label={t("git.filesView.label")}>
          {root === "loading" && <div className="empty-line">{t("common.loading")}</div>}
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
                  <span className={"status s-" + (status === "?" ? "q" : status)} title={statusName(t, status)}>
                    {status === "?" ? "U" : status}
                  </span>
                ) : (
                  changes.folders.has(entry.path) && <span className="change-dot" title={t("git.filesView.containsChanges")} />
                )}
              </div>
            );
          })}
          {Array.isArray(root) && root.length === 0 && <div className="empty-line">{t("git.filesView.noFiles")}</div>}
        </div>
      </div>
      <div className="files-content">
        {notice && (
          <div className="banner warn" role="status">
            <span>{notice}</span>
          </div>
        )}
        {gone ? (
          <div className="empty">
            <span>
              <Trans i18nKey={rev ? "git.filesView.goneAtCommit" : "git.filesView.gone"} values={{ path: selected }} components={{ code: <code className="mono" /> }} />
            </span>
          </div>
        ) : selectedIsFile && selected ? (
          <FilePane
            repo={repo}
            path={selected}
            content={content}
            rev={rev}
            snapshot={snapshot}
            showChanges={showChanges}
            onShowChanges={setShowChanges}
            onFollow={follow}
            onBack={history.length ? back : undefined}
          />
        ) : (
          <div className="empty">{t("git.filesView.selectFile")}</div>
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

type PaneProps = {
  repo: string;
  path: string;
  content: FileContent | { error: string } | null;
  rev: string | null;
  snapshot: Snapshot;
  showChanges: boolean;
  onShowChanges: (on: boolean) => void;
  onFollow: (link: Link) => void;
  onBack?: () => void;
};

function FilePane({ repo, path, content, rev, snapshot, showChanges, onShowChanges, onFollow, onBack }: PaneProps) {
  const { t } = useTranslation();
  const markdown = langOf(path) === "markdown";
  const [rendered, setRendered] = useState(true);
  const c = content && "path" in content && content.path === path ? content : null;
  const err = content && "error" in content ? content.error : null;
  return (
    <div className="file-pane">
      <div className="diff-head">
        {onBack && (
          <button className="icon-btn" onClick={onBack} title={t("git.filesView.back")}>
            <ArrowLeft size={14} />
          </button>
        )}
        <span className="path mono">{path}</span>
        {markdown && !showChanges && (
          <div className="segmented" role="radiogroup" aria-label={t("git.filesView.markdownMode")}>
            <button role="radio" aria-checked={rendered} className={rendered ? "on" : ""} onClick={() => setRendered(true)}>
              {t("git.filesView.rendered")}
            </button>
            <button role="radio" aria-checked={!rendered} className={!rendered ? "on" : ""} onClick={() => setRendered(false)}>
              {t("git.filesView.source")}
            </button>
          </div>
        )}
        {c && !showChanges && <span className="hint">{formatBytes(c.size)}</span>}
        {rev && <span className="hint mono">@ {rev.slice(0, 8)}</span>}
        <span className="spacer" />
        <button
          className={"changes-toggle" + (showChanges ? " on" : "")}
          aria-pressed={showChanges}
          title={t("git.filesView.changes.toggleHint")}
          onClick={() => onShowChanges(!showChanges)}
        >
          <FileDiff size={14} /> {t("git.filesView.changes.toggle")}
        </button>
      </div>
      {showChanges ? (
        <FileChanges repo={repo} path={path} rev={rev} snapshot={snapshot} />
      ) : err ? (
        <div className="empty danger">{err}</div>
      ) : !c ? (
        <div className="empty">{t("common.loading")}</div>
      ) : c.link_target !== null ? (
        <div className="empty">
          <Trans i18nKey="git.filesView.symlink" values={{ target: c.link_target }} components={{ code: <code className="mono" /> }} />
        </div>
      ) : c.binary ? (
        <div className="empty">{t("git.filesView.binary", { size: formatBytes(c.size) })}</div>
      ) : (
        <>
          {c.truncated && <div className="banner warn">{t("git.filesView.truncated", { shown: formatBytes(c.text?.length ?? 0), size: formatBytes(c.size) })}</div>}
          {markdown && rendered ? (
            <Suspense fallback={<div className="empty">{t("common.loading")}</div>}>
              <MarkdownView repo={repo} rev={rev} path={path} text={c.text ?? ""} onFollow={onFollow} />
            </Suspense>
          ) : (
            <CodeViewer path={path} text={c.text ?? ""} onFollow={onFollow} />
          )}
        </>
      )}
    </div>
  );
}
