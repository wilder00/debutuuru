// "Changes" in Files: the open file's diff, saying plainly what is compared.
// - The file has uncommitted changes: the last commit (HEAD) → your copy,
//   staged and unstaged together; a new file shows whole.
// - Otherwise (or when browsing a commit): the last commit that changed the
//   file, against the commit before it.
import { ArrowRight, GitCommitHorizontal, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DiffSource } from "../../bindings/DiffSource";
import type { LastChange } from "../../bindings/LastChange";
import type { Snapshot } from "../../bindings/Snapshot";
import { fullDate, relativeTime } from "../../lib/format";
import { git } from "./api";
import { FileDiffPanel } from "./FileDiffPanel";

type Props = {
  repo: string;
  path: string;
  /** Commit browsed in Files; null = the working tree. */
  rev: string | null;
  snapshot: Snapshot;
};

type Last = { key: string; change: LastChange | null } | { key: string; error: string };

export function FileChanges({ repo, path, rev, snapshot }: Props) {
  const { t } = useTranslation();
  const local = rev === null ? snapshot.status.files.find((f) => f.path === path) : undefined;
  const key = `${rev ?? ""}:${path}`;
  const [last, setLast] = useState<Last | null>(null);

  useEffect(() => {
    if (local) return;
    let stale = false;
    git
      .lastChange(repo, { rev: rev ?? undefined, path })
      .then((change) => !stale && setLast({ key, change }))
      .catch((e) => !stale && setLast({ key, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      stale = true;
    };
    // HEAD moves after a commit: look again with the new snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, key, !!local, snapshot.info.head_branch, snapshot.status.ahead]);

  if (local) {
    const untracked = local.worktree === "?";
    const source: DiffSource = untracked ? { kind: "untracked" } : { kind: "head" };
    return (
      <div className="file-changes">
        <div className="changes-explain" role="note">
          <Info size={14} />
          <span>{untracked ? t("git.filesView.changes.untracked") : t("git.filesView.changes.uncommitted")}</span>
          {!untracked && (
            <span className="compare mono">
              HEAD <ArrowRight size={11} /> {t("git.filesView.changes.yourCopy")}
            </span>
          )}
        </div>
        <FileDiffPanel repo={repo} source={source} path={path} origPath={untracked ? null : local.orig_path} reloadKey={snapshot} />
      </div>
    );
  }

  const cur = last?.key === key ? last : null;
  if (!cur) return <div className="empty">{t("common.loading")}</div>;
  if ("error" in cur) return <div className="empty danger">{cur.error}</div>;
  const c = cur.change;
  if (!c) return <div className="empty">{t("git.filesView.changes.noHistory")}</div>;
  const inThisCommit = rev !== null && c.hash.startsWith(rev);
  const explain =
    rev === null
      ? t("git.filesView.changes.lastCommit")
      : inThisCommit
        ? t("git.filesView.changes.thisCommit")
        : t("git.filesView.changes.before", { rev: rev.slice(0, 8) });
  return (
    <div className="file-changes">
      <div className="changes-explain" role="note">
        <Info size={14} />
        <span>{explain}</span>
        <span className="compare mono" title={`${c.hash}\n${c.subject}\n${c.author} · ${fullDate(c.time)}`}>
          {t("git.filesView.changes.parent")} <ArrowRight size={11} /> <GitCommitHorizontal size={11} /> {c.hash.slice(0, 8)}
        </span>
        <span className="commit-line" title={fullDate(c.time)}>
          {c.subject} · {c.author} · {relativeTime(c.time)}
        </span>
      </div>
      <FileDiffPanel repo={repo} source={{ kind: "commit", rev: c.hash }} path={path} origPath={c.orig_path} />
    </div>
  );
}
