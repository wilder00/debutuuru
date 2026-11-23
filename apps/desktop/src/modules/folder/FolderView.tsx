// Folder tab: the loose files of a folder of repositories (a ticket's notes
// and plans, often written by agents, next to its worktrees). Read-only,
// refreshed as files appear or change. Repositories inside are shown as
// such and open in their own tab.
import { useCallback, useEffect, useRef, useState } from "react";
import { FolderGit2, FolderOpen } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import type { FileContent } from "../../bindings/FileContent";
import { useBus } from "../../lib/bus";
import { AGENT_DISCONNECTED, onAgentEvent, repoName, wslDistro } from "../../lib/rpc";
import { FileTreeRows, useBookmarks, useFileTree } from "../git/FileTree";
import { DefinitionPicker, FilePane, useFollow } from "../git/FilesView";
import { fs, FS_CHANGED } from "./api";

type Props = {
  folder: string;
  /** Inactive tabs stay mounted but hidden. */
  active: boolean;
  /** Bumped by the title bar's refresh button (F5). */
  refreshKey: number;
  /** Opens a repository (or any path) in its own tab. */
  onOpen: (path: string) => void;
};

/** `folder` + `a/b` with the folder's own separator. */
const join = (folder: string, rel: string) => {
  const sep = folder.includes("\\") ? "\\" : "/";
  return folder.replace(/[\\/]+$/, "") + sep + rel.split("/").join(sep);
};

export function FolderView({ folder, active, refreshKey, onOpen }: Props) {
  const { t } = useTranslation();
  const list = useCallback((path: string) => fs.tree(folder, { path }), [folder]);
  const tree = useFileTree(list);
  const bookmarks = useBookmarks(folder);
  const [content, setContent] = useState<FileContent | { error: string } | null>(null);
  /** Bumped on every change, so the open file is read again. */
  const [version, setVersion] = useState(0);
  const { selected, selectedEntry } = tree;

  const { refresh: refreshTree } = tree;
  const refresh = useCallback(() => {
    refreshTree();
    setVersion((v) => v + 1);
  }, [refreshTree]);

  useEffect(() => {
    void fs.watch(folder).catch(() => {});
    return () => void fs.unwatch(folder).catch(() => {});
  }, [folder]);

  // A hidden tab only remembers it's out of date, and refreshes when shown.
  const activeRef = useRef(active);
  activeRef.current = active;
  const stale = useRef(false);
  useEffect(() => {
    if (active && stale.current) {
      stale.current = false;
      refresh();
    }
  }, [active, refresh]);

  useEffect(() => {
    const un = onAgentEvent((e) => {
      if (e.topic === FS_CHANGED && (e.payload as { repo?: string }).repo === folder) {
        if (activeRef.current) refresh();
        else stale.current = true;
      } else if (e.topic === AGENT_DISCONNECTED && (e.payload as { distro?: string }).distro === wslDistro(folder)) {
        // Its WSL agent restarted: watch again (any call reconnects).
        window.setTimeout(() => {
          refresh();
          void fs.watch(folder).catch(() => {});
        }, 1000);
      }
    });
    return () => void un.then((f) => f());
  }, [folder, refresh]);

  const firstKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey !== firstKey.current && activeRef.current) refresh();
  }, [refreshKey, refresh]);

  const kind = selectedEntry?.kind;
  useEffect(() => {
    if (!selected || kind === "dir" || kind === "submodule") return;
    let stale = false;
    fs.readFile(folder, { path: selected })
      .then((c) => !stale && setContent(c))
      .catch((e) => !stale && setContent({ error: e instanceof Error ? e.message : String(e) }));
    return () => {
      stale = true;
    };
  }, [folder, selected, kind, version]);

  // Quick open (Ctrl+P) on this tab.
  useBus("open-file", folder, (e) => tree.go(e.path));

  const follow = useFollow(
    tree,
    useCallback((p: string) => fs.readFile(folder, { path: p }), [folder]),
    useCallback((paths: string[]) => fs.statPaths(folder, { paths }), [folder]),
  );
  const readBytes = useCallback((path: string) => fs.readBytes(folder, { path }), [folder]);

  return (
    <div className="folder-view" hidden={!active}>
      <div className="files-view" onKeyDown={(e) => e.altKey && e.key === "ArrowLeft" && (e.preventDefault(), tree.back())}>
        <div className="files-tree">
          <div className="files-head folder-head" title={folder}>
            <FolderOpen size={14} />
            <span className="folder-name">{repoName(folder)}</span>
          </div>
          <FileTreeRows
            tree={tree}
            label={t("folder.label")}
            bookmarks={bookmarks}
            empty={t("folder.empty")}
            trailing={(entry) => entry.kind === "submodule" && <span className="hint">{t("folder.repo")}</span>}
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
                <Trans i18nKey="git.filesView.gone" values={{ path: selected }} components={{ code: <code className="mono" /> }} />
              </span>
            </div>
          ) : selected && kind === "submodule" ? (
            <div className="empty folder-repo">
              <FolderGit2 size={24} />
              <span>
                <Trans i18nKey="folder.isRepo" values={{ name: selectedEntry?.name }} components={{ code: <code className="mono" /> }} />
              </span>
              <button className="primary" onClick={() => onOpen(join(folder, selected))}>
                {t("folder.openRepo")}
              </button>
            </div>
          ) : selected && kind !== "dir" ? (
            <FilePane
              path={selected}
              content={content}
              readBytes={readBytes}
              bookmarked={bookmarks.has(selected)}
              onBookmark={() => bookmarks.toggle(selected)}
              onFollow={follow.follow}
              onDefine={follow.define}
              goto={follow.goto}
              onBack={tree.canGoBack ? tree.back : undefined}
            />
          ) : (
            <div className="empty">{t("folder.select")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
