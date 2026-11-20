import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangedEvent } from "../../bindings/ChangedEvent";
import type { LogEntry } from "../../bindings/LogEntry";
import type { Snapshot } from "../../bindings/Snapshot";
import { AGENT_DISCONNECTED, agentPathToRepo, onAgentEvent, wslDistro } from "../../lib/rpc";
import { git, GIT_CHANGED } from "./api";
import { ChangesPanel, type FileSelection } from "./ChangesPanel";
import { CommitGraph } from "./CommitGraph";
import { DiffView } from "./DiffView";
import { Sidebar } from "./Sidebar";

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
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [commit, setCommit] = useState<string | null>(null);
  const [file, setFile] = useState<FileSelection | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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

  // Load the diff for the selected file, again after every reload (the file
  // may have been edited while it's open).
  useEffect(() => {
    if (!file) return;
    const untracked = file.file.worktree === "?";
    git
      .diff(repo, { path: file.file.path, staged: file.staged, untracked: untracked && !file.staged })
      .then(setDiff)
      .catch((e) => setDiff(String(e)));
  }, [repo, file, snapshot]);

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

  if (!snapshot) {
    return (
      <div className="empty" hidden={!active}>
        {loadError ? <span className="danger">{loadError}</span> : repo.startsWith("\\\\wsl") ? "Connecting to WSL…" : "Loading repository…"}
      </div>
    );
  }

  return (
    <div className={"git-view" + (file ? " with-diff" : "")} hidden={!active}>
      <Sidebar
        snapshot={snapshot}
        onCheckout={(branch) => act(() => git.checkout(repo, { branch }))}
        onOpenWorktree={(p) => onOpen(agentPathToRepo(repo, p))}
      />
      <div className="center">
        <CommitGraph log={log} selected={commit} onSelect={setCommit} />
        {file && (
          <DiffView
            path={file.file.path}
            staged={file.staged}
            diff={diff}
            onClose={() => {
              setFile(null);
              setDiff(null);
            }}
          />
        )}
      </div>
      <ChangesPanel
        repo={repo}
        status={snapshot.status}
        selected={file}
        onSelect={(s) => {
          setDiff(null);
          setFile(s);
        }}
        act={act}
      />
    </div>
  );
}
