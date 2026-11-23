// Confirms deleting branches and says what it means for each one before
// anything happens: checked out (can't be deleted), merged (nothing lost),
// commits that exist only there (needs "delete anyway"; recoverable for a
// while with the shown command), commits not pushed, and the copy on the
// remote (stays, unless you choose to delete it too, which affects everyone).
// Then it deletes and shows what happened to each.
import { AlertTriangle, Ban, Check, CircleCheck, CircleX, Cloud, Copy, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BranchDeletion } from "../../bindings/BranchDeletion";
import type { Snapshot } from "../../bindings/Snapshot";
import { useSettings } from "../../settings/SettingsProvider";
import { git } from "./api";
import { sshCommandFor } from "./RemoteBar";

type Props = {
  repo: string;
  snapshot: Snapshot;
  names: string[];
  onClose: () => void;
  /** Something was deleted: reload. */
  onDone: () => void;
};

type Outcome = { label: string; ok: boolean; detail?: string };

/** `origin/feature/x` → ["origin", "feature/x"], with the repo's remote names. */
function splitRemote(snapshot: Snapshot, upstream: string): [string, string] | null {
  const r = [...snapshot.remotes].sort((a, b) => b.name.length - a.name.length).find((x) => upstream.startsWith(`${x.name}/`));
  return r ? [r.name, upstream.slice(r.name.length + 1)] : null;
}

export function DeleteBranchesDialog({ repo, snapshot, names, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const { git: gitSettings } = useSettings();
  const [info, setInfo] = useState<BranchDeletion[] | { error: string } | null>(null);
  const [force, setForce] = useState(false);
  const [alsoRemote, setAlsoRemote] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Outcome[] | null>(null);

  useEffect(() => {
    git
      .branchDeletionInfo(repo, names)
      .then(setInfo)
      .catch((e) => setInfo({ error: e instanceof Error ? e.message : String(e) }));
  }, [repo, names]);

  const list = Array.isArray(info) ? info : [];
  const blocked = (b: BranchDeletion) => b.is_head || b.worktree !== null;
  const locals = list.filter((b) => !b.is_remote && !blocked(b));
  const unmerged = locals.filter((b) => b.unique_commits > 0);
  const deletableLocals = locals.filter((b) => force || b.unique_commits === 0);
  const remotes = list.filter((b) => b.is_remote && b.remote && b.remote_branch);
  // Remote copies of the local branches being deleted (when asked to).
  const upstreams = alsoRemote
    ? deletableLocals.flatMap((b) => {
        const s = b.upstream ? splitRemote(snapshot, b.upstream) : null;
        return s && !remotes.some((r) => r.name === b.upstream) ? [{ local: b.name, remote: s[0], branch: s[1] }] : [];
      })
    : [];
  const withUpstream = locals.filter((b) => b.upstream && splitRemote(snapshot, b.upstream));
  const remoteCount = remotes.length + upstreams.length;
  const total = deletableLocals.length + remoteCount;

  async function run() {
    setRunning(true);
    const out: Outcome[] = [];
    try {
      if (deletableLocals.length) {
        const res = await git.deleteBranches(repo, { branches: deletableLocals.map((b) => b.name), force });
        for (const r of res) out.push({ label: r.name, ok: r.error === null, detail: r.error ?? undefined });
      }
      // Remote deletions, one push per remote; a local branch whose
      // deletion failed keeps its remote copy too.
      const failed = new Set(out.filter((o) => !o.ok).map((o) => o.label));
      const byRemote = new Map<string, string[]>();
      for (const r of remotes) byRemote.set(r.remote!, [...(byRemote.get(r.remote!) ?? []), r.remote_branch!]);
      for (const u of upstreams) if (!failed.has(u.local)) byRemote.set(u.remote, [...(byRemote.get(u.remote) ?? []), u.branch]);
      for (const [remote, branches] of byRemote) {
        try {
          const o = await git.deleteRemoteBranches(repo, {
            op_id: `delete-${Date.now()}`,
            ssh_command: sshCommandFor(repo, gitSettings),
            remote,
            branches,
          });
          for (const b of branches) out.push({ label: `${remote}/${b}`, ok: o.ok, detail: o.ok ? undefined : o.summary });
        } catch (e) {
          for (const b of branches) out.push({ label: `${remote}/${b}`, ok: false, detail: e instanceof Error ? e.message : String(e) });
        }
      }
    } catch (e) {
      out.push({ label: t("git.branches.delete.failed"), ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
      setResults(out);
      onDone();
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal wide" role="dialog" aria-labelledby="del-title" onKeyDown={(e) => e.key === "Escape" && !running && onClose()}>
        <header>
          <Trash2 size={18} />
          <h2 id="del-title">{t("git.branches.delete.title", { count: names.length })}</h2>
        </header>

        {results ? (
          <>
            <ul className="del-list">
              {results.map((r) => (
                <li key={r.label} className="del-item">
                  {r.ok ? <CircleCheck size={15} className="ok" /> : <CircleX size={15} className="danger" />}
                  <div>
                    <span className="mono">{r.label}</span> {r.ok ? t("git.branches.delete.deleted") : t("git.branches.delete.notDeleted")}
                    {r.detail && <pre className="del-detail mono">{r.detail}</pre>}
                  </div>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button className="primary" autoFocus onClick={onClose}>
                {t("git.branches.delete.close")}
              </button>
            </div>
          </>
        ) : info === null ? (
          <div className="empty-line">
            <Loader2 size={14} className="spin" /> {t("git.branches.delete.checking")}
          </div>
        ) : "error" in info ? (
          <>
            <div className="danger">{info.error}</div>
            <div className="modal-actions">
              <button onClick={onClose}>{t("git.branches.delete.close")}</button>
            </div>
          </>
        ) : (
          <>
            <ul className="del-list">
              {list.map((b) => (
                <BranchRow key={b.name} b={b} head={snapshot.info.head_branch} force={force} alsoRemote={alsoRemote} />
              ))}
            </ul>

            {unmerged.length > 0 && (
              <label className="toggle-row danger-option">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                <span>
                  {t("git.branches.delete.force", { count: unmerged.length })}
                  <span className="hint block">{t("git.branches.delete.forceHint")}</span>
                </span>
              </label>
            )}
            {withUpstream.length > 0 && (
              <label className="toggle-row danger-option">
                <input type="checkbox" checked={alsoRemote} onChange={(e) => setAlsoRemote(e.target.checked)} />
                <span>
                  {t("git.branches.delete.alsoRemote", { count: withUpstream.length })}
                  <span className="hint block">{t("git.branches.delete.alsoRemoteHint")}</span>
                </span>
              </label>
            )}

            <p className="del-summary">
              {total === 0
                ? t("git.branches.delete.nothing")
                : t("git.branches.delete.summary", { local: deletableLocals.length, remote: remoteCount })}
            </p>
            <div className="modal-actions">
              <button onClick={onClose} disabled={running} autoFocus>
                {t("common.cancel")}
              </button>
              <button className="danger-btn" disabled={total === 0 || running} onClick={() => void run()}>
                {running ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} {t("git.branches.delete.confirm", { count: total })}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** One branch: what deleting it means, in plain words. */
function BranchRow({ b, head, force, alsoRemote }: { b: BranchDeletion; head: string | null; force: boolean; alsoRemote: boolean }) {
  const { t } = useTranslation();
  const lines: { kind: "ok" | "warn" | "danger" | "info"; text: string; copy?: string }[] = [];
  let skipped = false;
  if (b.is_head) {
    skipped = true;
    lines.push({ kind: "info", text: t("git.branches.delete.isHead") });
  } else if (b.worktree) {
    skipped = true;
    lines.push({ kind: "info", text: t("git.branches.delete.inWorktree", { path: b.worktree }) });
  } else if (b.is_remote) {
    lines.push({ kind: "danger", text: t("git.branches.delete.remoteEveryone", { branch: b.remote_branch ?? b.name, remote: b.remote ?? "" }) });
    if (b.unique_commits > 0) lines.push({ kind: "danger", text: t("git.branches.delete.remoteUnique", { count: b.unique_commits }) });
    else lines.push({ kind: "ok", text: t("git.branches.delete.remoteSafe") });
  } else {
    if (b.unique_commits === 0) {
      lines.push({ kind: "ok", text: b.merged_into_head && head ? t("git.branches.delete.mergedInto", { head }) : t("git.branches.delete.nothingLost") });
    } else {
      skipped = !force;
      lines.push({ kind: "danger", text: t("git.branches.delete.unique", { count: b.unique_commits }) });
      lines.push({ kind: "info", text: t("git.branches.delete.restore"), copy: `git branch ${b.name} ${b.sha}` });
      if (!force) lines.push({ kind: "warn", text: t("git.branches.delete.skippedUnlessForce") });
    }
    if (b.ahead > 0 && b.upstream) lines.push({ kind: "warn", text: t("git.branches.delete.notPushed", { count: b.ahead, upstream: b.upstream }) });
    if (b.upstream) {
      lines.push({
        kind: alsoRemote ? "danger" : "info",
        text: alsoRemote ? t("git.branches.delete.upstreamToo", { upstream: b.upstream }) : t("git.branches.delete.upstreamStays", { upstream: b.upstream }),
      });
    }
  }
  const Icon = { ok: Check, warn: AlertTriangle, danger: AlertTriangle, info: b.is_remote ? Cloud : Ban }[lines[0]?.kind ?? "info"];
  return (
    <li className={"del-item" + (skipped ? " skipped" : "")}>
      <Icon size={15} className={lines[0]?.kind ?? ""} />
      <div>
        <div className="del-name">
          <span className="mono">{b.name}</span>
          <span className="hint mono">{b.sha.slice(0, 8)}</span>
          {skipped && <span className="tag-badge">{t("git.branches.delete.skipped")}</span>}
        </div>
        <ul className="del-notes">
          {lines.map((l, i) => (
            <li key={i} className={l.kind === "info" ? "" : l.kind}>
              {l.text}
              {l.copy && (
                <button className="link-btn mono" title={t("git.branches.delete.copyCommand")} onClick={() => void navigator.clipboard.writeText(l.copy!)}>
                  <Copy size={11} /> {l.copy}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}
