// Files: the repository's file tree and a read-only viewer, for the working
// tree (with live changes marked) or for any commit. Ctrl+click on an import
// opens the imported file; Markdown is shown rendered by default.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, FileDiff, X } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import type { FileBytes } from "../../bindings/FileBytes";
import type { FileContent } from "../../bindings/FileContent";
import type { GrepMatch } from "../../bindings/GrepMatch";
import type { Snapshot } from "../../bindings/Snapshot";
import { formatBytes } from "../../lib/format";
import { git } from "./api";
import { CodeViewer } from "./CodeViewer";
import { findDefinitions, type Def, type Sym } from "./definitions";
import { FileIcon } from "./fileIcons";
import { FileChanges } from "./FileChanges";
import { BookmarkButton, FileTreeRows, useBookmarks, useFileTree, type FileTreeState } from "./FileTree";
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

// Rendered Markdown (react-markdown, KaTeX…) loads the first time it's shown.
const MarkdownView = lazy(() => import("./MarkdownView").then((m) => ({ default: m.MarkdownView })));

export function FilesView({ repo, snapshot, rev, revOptions, onRev, openRequest }: Props) {
  const { t } = useTranslation();
  const [showIgnored, setShowIgnored] = useState(false);
  const [content, setContent] = useState<FileContent | { error: string } | null>(null);
  /** "Changes" instead of the content; stays on while moving between files. */
  const [showChanges, setShowChanges] = useState(false);
  const list = useCallback((path: string) => git.tree(repo, { rev: rev ?? undefined, path, show_ignored: showIgnored }), [repo, rev, showIgnored]);
  const tree = useFileTree(list);
  const bookmarks = useBookmarks(repo);
  const { selected } = tree;

  // Working tree: every repo change (the agent's watcher reloads the
  // snapshot) refreshes the open folders and the open file, without flicker.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (rev === null) tree.refresh();
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

  const follow = useFollow(
    tree,
    useCallback((p: string) => git.readFile(repo, { rev: rev ?? undefined, path: p }), [repo, rev]),
    useCallback((paths: string[]) => git.statPaths(repo, { rev: rev ?? undefined, paths }), [repo, rev]),
    useCallback((patterns: string[], paths: string[]) => git.grep(repo, { rev: rev ?? undefined, patterns, paths, max: 200 }), [repo, rev]),
  );

  useEffect(() => {
    if (openRequest) tree.go(openRequest.path);
    // Only for a new request, not when `go` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  const readBytes = useCallback((path: string) => git.readBytes(repo, { rev: rev ?? undefined, path }), [repo, rev]);

  return (
    <div className="files-view" onKeyDown={(e) => e.altKey && e.key === "ArrowLeft" && (e.preventDefault(), tree.back())}>
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
        <FileTreeRows
          tree={tree}
          label={t("git.filesView.label")}
          bookmarks={bookmarks}
          empty={t("git.filesView.noFiles")}
          trailing={(entry) => {
            const status = changes.files.get(entry.path);
            if (status)
              return (
                <span className={"status s-" + (status === "?" ? "q" : status)} title={statusName(t, status)}>
                  {status === "?" ? "U" : status}
                </span>
              );
            return changes.folders.has(entry.path) && <span className="change-dot" title={t("git.filesView.containsChanges")} />;
          }}
        />
      </div>
      <div className="files-content">
        {follow.notice && (
          <div className="banner warn" role="status">
            <span>{follow.notice}</span>
          </div>
        )}
        {follow.picker && <DefinitionPicker {...follow.picker} onPick={follow.open} onClose={follow.closePicker} />}
        {tree.gone ? (
          <div className="empty">
            <span>
              <Trans i18nKey={rev ? "git.filesView.goneAtCommit" : "git.filesView.gone"} values={{ path: selected }} components={{ code: <code className="mono" /> }} />
            </span>
          </div>
        ) : selected && tree.selectedEntry?.kind !== "dir" ? (
          <FilePane
            path={selected}
            content={content}
            readBytes={readBytes}
            revLabel={rev?.slice(0, 8)}
            bookmarked={bookmarks.has(selected)}
            onBookmark={() => bookmarks.toggle(selected)}
            changes={{ on: showChanges, onToggle: setShowChanges, view: <FileChanges repo={repo} path={selected} rev={rev} snapshot={snapshot} /> }}
            onFollow={follow.follow}
            onDefine={follow.define}
            goto={follow.goto}
            onBack={tree.canGoBack ? tree.back : undefined}
          />
        ) : (
          <div className="empty">{t("git.filesView.selectFile")}</div>
        )}
      </div>
    </div>
  );
}

/** Ctrl+click on an import or a link: opens the first candidate that exists,
 *  or says it found none. On a name: goes to its definition, or offers them
 *  all when there are several (`grep` searches the whole repository). */
export function useFollow(
  tree: FileTreeState,
  readFile: (path: string) => Promise<FileContent>,
  statPaths: (paths: string[]) => Promise<(string | null)[]>,
  grep: ((patterns: string[], paths: string[]) => Promise<GrepMatch[]>) | null = null,
) {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ name: string; defs: Def[] } | null>(null);
  const [goto, setGoto] = useState<{ path: string; line: number; key: number } | null>(null);
  const selected = tree.selected;
  const { go } = tree;

  /** Opens a definition at its line. */
  const open = useCallback(
    (d: Def) => {
      setPicker(null);
      go(d.path);
      setGoto({ path: d.path, line: d.line, key: Date.now() });
    },
    [go],
  );

  // Another file opened from the tree: forget the line.
  useEffect(() => {
    if (goto && selected !== goto.path) setGoto(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const search = useRef(0);
  const define = useCallback(
    async (path: string, text: string, sym: Sym) => {
      const n = ++search.current;
      setNotice(null);
      setPicker(null);
      const searching = window.setTimeout(() => n === search.current && setNotice(t("git.filesView.definition.searching", { name: sym.name })), 400);
      const read = (p: string) =>
        readFile(p)
          .then((c) => c.text ?? null)
          .catch(() => null);
      try {
        const found = await findDefinitions(sym, path, text, langOf(path), { read, stat: statPaths, grep });
        if (n !== search.current) return;
        setNotice(null);
        if (found.defs.length === 1) open(found.defs[0]);
        else if (found.defs.length > 1) setPicker({ name: sym.name, defs: found.defs });
        else setNotice(t(found.here ? "git.filesView.definition.here" : "git.filesView.definition.notFound", { name: sym.name }));
      } catch (e) {
        if (n === search.current) setNotice(e instanceof Error ? e.message : String(e));
      } finally {
        window.clearTimeout(searching);
      }
    },
    [readFile, statPaths, grep, open, t],
  );
  const follow = useCallback(
    async (link: Link) => {
      const from = selected ?? "";
      setNotice(null);
      const read = (p: string) =>
        readFile(p)
          .then((c) => c.text ?? null)
          .catch(() => null);
      try {
        const paths = await candidates(link, from, { read });
        for (let i = 0; i < paths.length; i += 64) {
          const chunk = paths.slice(i, i + 64);
          const kinds = await statPaths(chunk);
          const k = kinds.findIndex((kind) => kind !== null);
          if (k >= 0) {
            go(chunk[k], kinds[k] === "dir" || kinds[k] === "submodule");
            return;
          }
        }
        setNotice(t("git.filesView.linkNotFound", { spec: link.spec }));
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      }
    },
    [selected, go, readFile, statPaths, t],
  );

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(id);
  }, [notice]);

  return { follow, notice, define, picker, open, closePicker: () => setPicker(null), goto };
}

/** Several definitions of a name: pick one (arrows and Enter, or a click). */
export function DefinitionPicker({ name, defs, onPick, onClose }: { name: string; defs: Def[]; onPick: (d: Def) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [i, setI] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  useEffect(() => {
    ref.current?.querySelector(".def-row.selected")?.scrollIntoView({ block: "nearest" });
  }, [i]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setI((x) => Math.min(defs.length - 1, x + 1));
    else if (e.key === "ArrowUp") setI((x) => Math.max(0, x - 1));
    else if (e.key === "Enter") onPick(defs[i]);
    else if (e.key === "Escape") onClose();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div className="def-picker" ref={ref} tabIndex={-1} onKeyDown={onKey} role="listbox" aria-label={t("git.filesView.definition.title", { count: defs.length, name }).replace(/<\/?code>/g, "")}>
      <div className="def-picker-head">
        <span>
          <Trans i18nKey="git.filesView.definition.title" count={defs.length} values={{ name }} components={{ code: <code className="mono" /> }} />
        </span>
        <span className="spacer" />
        <button className="icon-btn" onClick={onClose} title={t("git.filesView.definition.close")}>
          <X size={14} />
        </button>
      </div>
      <div className="def-picker-list">
        {defs.map((d, k) => {
          const file = d.path.slice(d.path.lastIndexOf("/") + 1);
          return (
            <div
              key={`${d.path}:${d.line}`}
              role="option"
              aria-selected={k === i}
              className={"item def-row" + (k === i ? " selected" : "")}
              onMouseEnter={() => setI(k)}
              onClick={() => onPick(d)}
              title={`${d.path}:${d.line}`}
            >
              <FileIcon name={file} />
              <span className="def-file">
                {file}
                <span className="hint">:{d.line}</span>
              </span>
              <span className="def-text mono">{d.text}</span>
              <span className="hint def-dir">{d.path.slice(0, Math.max(0, d.path.length - file.length - 1))}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type PaneProps = {
  path: string;
  content: FileContent | { error: string } | null;
  /** Images in rendered Markdown (stable between renders). */
  readBytes: (path: string) => Promise<FileBytes>;
  /** Short commit shown next to the path (`@ 1a2b3c4d`). */
  revLabel?: string;
  bookmarked: boolean;
  onBookmark: () => void;
  /** Repositories: the "Changes" toggle and what it shows. */
  changes?: { on: boolean; onToggle: (on: boolean) => void; view: ReactNode };
  onFollow: (link: Link) => void;
  /** Ctrl+click on a name: its definition (`text` is the file's). */
  onDefine?: (path: string, text: string, sym: Sym) => void;
  /** The line to show, when a definition was opened in this file. */
  goto?: { path: string; line: number; key: number } | null;
  onBack?: () => void;
};

/** One file: rendered Markdown or the code viewer, and its header. */
export function FilePane({ path, content, readBytes, revLabel, bookmarked, onBookmark, changes, onFollow, onDefine, goto, onBack }: PaneProps) {
  const { t } = useTranslation();
  const markdown = langOf(path) === "markdown";
  const [rendered, setRendered] = useState(true);
  const c = content && "path" in content && content.path === path ? content : null;
  const err = content && "error" in content ? content.error : null;
  const showChanges = changes?.on ?? false;
  return (
    <div className="file-pane">
      <div className="diff-head">
        {onBack && (
          <button className="icon-btn" onClick={onBack} title={t("git.filesView.back")}>
            <ArrowLeft size={14} />
          </button>
        )}
        <span className="path mono">{path}</span>
        <BookmarkButton on={bookmarked} onToggle={onBookmark} className="shown" />
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
        {revLabel && <span className="hint mono">@ {revLabel}</span>}
        <span className="spacer" />
        {changes && (
          <button
            className={"changes-toggle" + (showChanges ? " on" : "")}
            aria-pressed={showChanges}
            title={t("git.filesView.changes.toggleHint")}
            onClick={() => changes.onToggle(!showChanges)}
          >
            <FileDiff size={14} /> {t("git.filesView.changes.toggle")}
          </button>
        )}
      </div>
      {showChanges && changes ? (
        changes.view
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
              <MarkdownView readBytes={readBytes} path={path} text={c.text ?? ""} onFollow={onFollow} />
            </Suspense>
          ) : (
            <CodeViewer
              path={path}
              text={c.text ?? ""}
              onFollow={onFollow}
              onDefine={onDefine && ((s) => onDefine(path, c.text ?? "", s))}
              goto={goto?.path === path ? goto : null}
            />
          )}
        </>
      )}
    </div>
  );
}
