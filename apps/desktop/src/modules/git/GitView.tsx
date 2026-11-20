import { useCallback, useEffect, useState } from "react";
import type { LogEntry } from "../../bindings/LogEntry";
import type { Snapshot } from "../../bindings/Snapshot";
import { git } from "./api";
import { ChangesPanel, type FileSelection } from "./ChangesPanel";
import { CommitGraph } from "./CommitGraph";
import { DiffView } from "./DiffView";
import { Sidebar } from "./Sidebar";

const LOG_LIMIT = 2000; // paginated loading comes with Phase 1

type Props = {
  repo: string;
  /** Bumped by the title bar's refresh button. */
  refreshKey: number;
  onError: (e: unknown) => void;
  onOpen: (path: string) => void;
  onLoaded: (s: Snapshot) => void;
};

export function GitView({ repo, refreshKey, onError, onOpen, onLoaded }: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [commit, setCommit] = useState<string | null>(null);
  const [file, setFile] = useState<FileSelection | null>(null);
  const [diff, setDiff] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [s, l] = await Promise.all([git.snapshot(repo), git.log(repo, { limit: LOG_LIMIT })]);
    setSnapshot(s);
    setLog(l);
    onLoaded(s);
    return s;
  }, [repo, onLoaded]);

  useEffect(() => {
    reload().catch(onError);
  }, [reload, onError, refreshKey]);

  // Load the diff for the selected file; drop the selection if the file is gone.
  useEffect(() => {
    if (!file) return;
    setDiff(null);
    const untracked = file.file.worktree === "?";
    git
      .diff(repo, { path: file.file.path, staged: file.staged, untracked: untracked && !file.staged })
      .then(setDiff)
      .catch((e) => setDiff(String(e)));
  }, [repo, file]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        const s = await reload();
        setFile((cur) => {
          if (!cur) return cur;
          const still = s.status.files.find((f) => f.path === cur.file.path);
          if (!still) return null;
          const inList = cur.staged ? still.index !== " " && still.index !== "?" : still.worktree !== " ";
          return inList ? { ...cur, file: still } : { file: still, staged: !cur.staged };
        });
        return true;
      } catch (e) {
        onError(e);
        return false;
      }
    },
    [reload, onError],
  );

  if (!snapshot) return <div className="empty">Loading repository…</div>;

  return (
    <div className={"git-view" + (file ? " with-diff" : "")}>
      <Sidebar snapshot={snapshot} onCheckout={(branch) => act(() => git.checkout(repo, { branch }))} onOpenWorktree={onOpen} />
      <div className="center">
        <CommitGraph log={log} selected={commit} onSelect={setCommit} />
        {file && <DiffView path={file.file.path} staged={file.staged} diff={diff} onClose={() => setFile(null)} />}
      </div>
      <ChangesPanel repo={repo} status={snapshot.status} selected={file} onSelect={setFile} act={act} />
    </div>
  );
}
