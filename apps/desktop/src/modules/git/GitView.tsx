import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChangedEvent } from "../../bindings/ChangedEvent";
import type { LogEntry } from "../../bindings/LogEntry";
import type { Snapshot } from "../../bindings/Snapshot";
import { AGENT_DISCONNECTED, agentPathToRepo, onAgentEvent, wslDistro } from "../../lib/rpc";
import { git, GIT_CHANGED } from "./api";
import { ChangesPanel, type FileSelection } from "./ChangesPanel";
import { CommitGraph } from "./CommitGraph";
import { RemoteBar } from "./RemoteBar";
import { useBus } from "../../lib/bus";
import { ErrorBoundary } from "../../lib/ErrorBoundary";
import { useSettings } from "../../settings/SettingsProvider";
import { Sidebar } from "./Sidebar";

// Code viewer (CodeMirror) is only downloaded when Files is first opened.
const FilesView = lazy(() => import("./FilesView").then((m) => ({ default: m.FilesView })));
// Same for the diff viewer (CodeMirror merge), loaded when a diff is first opened.
const FileDiffPanel = lazy(() => import("./FileDiffPanel").then((m) => ({ default: m.FileDiffPanel })));
const CommitPanel = lazy(() => import("./CommitPanel").then((m) => ({ default: m.CommitPanel })));

const LOG_LIMIT = 2000; // paginated loading comes with a later phase

type Props = {
  repo: string;
  /** Inactive tabs stay mounted (keeping scroll/selection) but hidden. */
  active: boolean;
  /** Bumped by the title bar's refresh button. */
  refreshKey: number;
  onError: (e: unknown) => void;
  onOpen: (path: string) => void;
  onLoaded: (repo: string, s: Snapshot) => void;
};

export function GitView({ repo, active, refreshKey, onError, onOpen, onLoaded }: Props) {
  const { t } = useTranslation();
  const { git: gitSettings } = useSettings();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [commit, setCommit] = useState<string | null>(null);
  const [file, setFile] = useState<FileSelection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<"history" | "files">("history");
  /** Commit browsed in Files; null = working tree. */
  const [filesRev, setFilesRev] = useState<string | null>(null);
  // Files stays mounted once opened (hidden in History), so open folders and
  // the open file survive switching views.
  const [filesOpened, setFilesOpened] = useState(false);
  useEffect(() => {
    if (view === "files") setFilesOpened(true);
  }, [view]);
  const loading = useRef(false);
  const pending = useRef(false);

  // Coalesces bursts: at most one reload in flight plus one queued.
  const reload = useCallback(async (): Promise<Snapshot | null> => {
    if (loading.current) {
      pending.current = true;
      return null;
    }
    loading.current = true;
    try {
      const [s, l] = await Promise.all([git.snapshot(repo), git.log(repo, { limit: LOG_LIMIT })]);
      setSnapshot(s);
      setLog(l);
      setLoadError(null);
      onLoaded(repo, s);
      return s;
    } finally {
      loading.current = false;
      if (pending.current) {
        pending.current = false;
        void reload().catch(onError);
      }
    }
  }, [repo, onLoaded, onError]);

  // Initial load + start the agent's file watcher (idempotent, so it also
  // re-arms watching after a WSL agent restart).
  useEffect(() => {
    reload()
      .then(() => git.watch(repo))
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : String(e));
        onError(e);
      });
  }, [reload, onError, refreshKey, repo]);

  useEffect(() => () => void git.unwatch(repo).catch(() => {}), [repo]);

  // Auto-refresh on changes reported by the agent (files, index, refs). If
  // this repo's WSL agent died, reconnect (any call does) and re-arm watching.
  useEffect(() => {
    const un = onAgentEvent((e) => {
      if (e.topic === GIT_CHANGED && (e.payload as ChangedEvent).repo === repo) {
        void reload().catch(onError);
      } else if (e.topic === AGENT_DISCONNECTED && (e.payload as { distro?: string }).distro === wslDistro(repo)) {
        window.setTimeout(() => {
          reload()
            .then(() => git.watch(repo))
            .catch(onError);
        }, 1000);
      }
    });
    return () => void un.then((f) => f());
  }, [repo, reload, onError]);

  // Keep the selected file in sync with the latest status (it may move
  // between staged/unstaged or disappear after a commit).
  useEffect(() => {
    if (!snapshot) return;
    setFile((cur) => {
      if (!cur) return cur;
      const still = snapshot.status.files.find((f) => f.path === cur.file.path);
      if (!still) return null;
      const inList = cur.staged ? still.index !== " " && still.index !== "?" : still.worktree !== " ";
      const next = inList ? { ...cur, file: still } : { file: still, staged: !cur.staged };
      return next.file.index === cur.file.index && next.file.worktree === cur.file.worktree && next.staged === cur.staged ? cur : next;
    });
  }, [snapshot]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        await reload();
        return true;
      } catch (e) {
        onError(e);
        return false;
      }
    },
    [reload, onError],
  );

  // Command palette: open a file in Files, switch views, check out a branch.
  const [openRequest, setOpenRequest] = useState<{ path: string; n: number } | null>(null);
  useBus("open-file", repo, (e) => {
    setFilesRev(null);
    setView("files");
    setOpenRequest({ path: e.path, n: Date.now() });
  });
  useBus("show-view", repo, (e) => setView(e.view));

  // The diff / commit panel can take the whole tab (to read the details);
  // the same button, Esc or the palette brings the normal layout back.
  const panelOpen = !!(file || commit) && view === "history";
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!panelOpen) setExpanded(false);
  }, [panelOpen]);
  useBus("toggle-expand", repo, () => panelOpen && setExpanded((x) => !x));
  useEffect(() => {
    if (!expanded || !active) return;
    const onKey = (e: KeyboardEvent) => {
      // Not when Esc already closed something (editor search, a menu, a dialog).
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector(".palette, .drawer, .modal, .menu")) return;
      setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, active]);
  const expand = { expanded, toggle: () => setExpanded((x) => !x) };
  useBus("checkout", repo, (e) => void act(() => git.checkout(repo, { branch: e.branch })));

  if (!snapshot) {
    return (
      <div className="empty" hidden={!active}>
        {loadError ? <span className="danger">{loadError}</span> : repo.startsWith("\\\\wsl") ? t("git.connectingWsl") : t("git.loadingRepo")}
      </div>
    );
  }

  return (
    <div className={"git-view" + (panelOpen ? " with-diff" : "") + (expanded ? " expanded" : "")} hidden={!active}>
      <Sidebar
        snapshot={snapshot}
        onCheckout={(branch) => act(() => git.checkout(repo, { branch }))}
        onOpenWorktree={(p) => onOpen(agentPathToRepo(repo, p))}
      />
      <div className="center">
        <RemoteBar repo={repo} snapshot={snapshot} settings={gitSettings} onDone={() => void reload().catch(onError)} />
        <div className="view-tabs" role="tablist">
          <button role="tab" aria-selected={view === "history"} className={view === "history" ? "on" : ""} onClick={() => setView("history")}>
            {t("git.history")}
          </button>
          <button role="tab" aria-selected={view === "files"} className={view === "files" ? "on" : ""} onClick={() => setView("files")}>
            {t("git.files")}
          </button>
          {view === "history" && <span className="hint">{t("git.historyHint")}</span>}
        </div>
        {filesOpened && (
          <div className="view-pane" hidden={view !== "files"}>
            <Suspense fallback={<div className="empty">{t("common.loading")}</div>}>
              <FilesView repo={repo} snapshot={snapshot} rev={filesRev} revOptions={revOptions(log, [filesRev, commit])} onRev={setFilesRev} openRequest={openRequest} />
            </Suspense>
          </div>
        )}
        <div className="view-pane" hidden={view !== "history"}>
          <CommitGraph
            log={log}
            selected={commit}
            onSelect={(hash) => {
              setFile(null);
              setCommit(hash);
            }}
            onOpen={(hash) => {
              setFilesRev(hash);
              setView("files");
            }}
          />
        </div>
        <ErrorBoundary resetKey={file?.file.path ?? commit}>
        <Suspense fallback={<div className="empty">{t("common.loading")}</div>}>
        {view === "history" && file && (
          <FileDiffPanel
            repo={repo}
            source={file.staged ? { kind: "staged" } : file.file.worktree === "?" ? { kind: "untracked" } : { kind: "unstaged" }}
            path={file.file.path}
            origPath={file.staged ? file.file.orig_path : null}
            reloadKey={snapshot}
            expand={expand}
            onClose={() => setFile(null)}
          />
        )}
        {view === "history" && !file && commit && <CommitPanel repo={repo} hash={commit} onClose={() => setCommit(null)} expand={expand} />}
        </Suspense>
        </ErrorBoundary>
      </div>
      <ChangesPanel
        repo={repo}
        status={snapshot.status}
        selected={file}
        onSelect={(s) => {
          setCommit(null);
          setFile(s);
          setView("history");
        }}
        act={act}
      />
    </div>
  );
}

/** Files revision picker: the browsed commit and the one selected in History. */
function revOptions(log: LogEntry[], revs: (string | null)[]) {
  return [...new Set(revs.filter((r): r is string => !!r))].map((rev) => {
    const c = log.find((e) => e.hash === rev);
    return { value: rev, label: c ? `${rev.slice(0, 8)} · ${c.subject}` : rev.slice(0, 8) };
  });
}
