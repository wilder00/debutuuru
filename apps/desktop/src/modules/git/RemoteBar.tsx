import { ArrowDown, ArrowUp, Check, ChevronDown, CircleX, Loader2, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FailureHint } from "../../bindings/FailureHint";
import type { GitSettings } from "../../bindings/GitSettings";
import type { OpOutcome } from "../../bindings/OpOutcome";
import type { ProgressEvent } from "../../bindings/ProgressEvent";
import type { PullMode } from "../../bindings/PullMode";
import type { Snapshot } from "../../bindings/Snapshot";
import { onAgentEvent, wslDistro } from "../../lib/rpc";
import { git, GIT_PROGRESS } from "./api";

type Kind = "fetch" | "pull" | "push";
type Running = { kind: Kind; opId: string; text: string; percent: number | null };
type Result = { kind: Kind; outcome: OpOutcome };

const isWindowsHost = navigator.userAgent.includes("Windows");

/** SSH program for a repo: WSL repos always use their distro's own ssh; Windows
 *  repos use the user's git config unless they opted into WSL's keys. */
export function sshCommandFor(repo: string, s: GitSettings): string | null {
  if (wslDistro(repo) || !isWindowsHost || s.windows_ssh !== "wsl") return null;
  return s.wsl_distro ? `wsl.exe -d ${s.wsl_distro} -e ssh` : "wsl.exe -e ssh";
}

/** What to do next, in plain words. */
function advice(hint: FailureHint | null, ctx: { windowsRepo: boolean; usingWslSsh: boolean }): string | null {
  switch (hint) {
    case "ssh_auth":
      return ctx.windowsRepo && !ctx.usingWslSsh
        ? "SSH from Windows couldn't authenticate. If your SSH keys live in WSL, turn on “Use WSL's SSH keys for Windows repositories” in Settings (Ctrl+,)."
        : "SSH couldn't authenticate. Check with `ssh -T git@<host>` in a terminal that your key is accepted and the repository URL is right.";
    case "host_key":
      return "The server's host key wasn't trusted, so nothing was sent. Run Fetch again and accept it if the fingerprint matches your Git host's published one.";
    case "https_auth":
      return "Credentials were rejected. Most hosts need a personal access token instead of a password, or Git Credential Manager.";
    case "rejected":
      return "The remote has commits you don't have. Pull first, then push.";
    case "diverged":
      return "Your branch and the remote have diverged. Use Pull ▸ Rebase or Pull ▸ Merge.";
    case "local_changes":
      return "Commit or stash your local changes before pulling.";
    case "conflict":
      return "The pull stopped with conflicts. Resolve them, then commit.";
    case "network":
      return "Couldn't reach the remote. Check your connection, VPN or proxy.";
    default:
      return null;
  }
}

type Props = {
  repo: string;
  snapshot: Snapshot;
  settings: GitSettings;
  /** Called after every operation (the watcher also refreshes, this is faster). */
  onDone: () => void;
};

export function RemoteBar({ repo, snapshot, settings, onDone }: Props) {
  const [running, setRunning] = useState<Running | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [details, setDetails] = useState(false);
  const [menu, setMenu] = useState<"pull" | "push" | null>(null);
  const [confirmForce, setConfirmForce] = useState(false);
  const runningRef = useRef<Running | null>(null);
  runningRef.current = running;

  useEffect(() => {
    const un = onAgentEvent((e) => {
      const p = e.payload as ProgressEvent;
      if (e.topic === GIT_PROGRESS && p.op_id === runningRef.current?.opId) {
        setRunning((r) => (r ? { ...r, text: p.text, percent: p.percent } : r));
      }
    });
    return () => void un.then((f) => f());
  }, []);

  // Successes fade out; failures stay until dismissed.
  useEffect(() => {
    if (!result?.outcome.ok) return;
    const t = window.setTimeout(() => setResult(null), 5000);
    return () => window.clearTimeout(t);
  }, [result]);

  async function run(kind: Kind, extra: { mode?: PullMode; force_with_lease?: boolean } = {}) {
    setMenu(null);
    setConfirmForce(false);
    setResult(null);
    setDetails(false);
    const opId = `${kind}-${Date.now()}`;
    setRunning({ kind, opId, text: "Starting…", percent: null });
    const options = { op_id: opId, ssh_command: sshCommandFor(repo, settings) };
    try {
      const outcome =
        kind === "fetch"
          ? await git.fetch(repo, { ...options, remote: null })
          : kind === "pull"
            ? await git.pull(repo, { ...options, mode: extra.mode ?? "default" })
            : await git.push(repo, { ...options, force_with_lease: extra.force_with_lease ?? false });
      setResult({ kind, outcome });
    } catch (e) {
      setResult({ kind, outcome: { ok: false, summary: e instanceof Error ? e.message : String(e), hint: null, log: "" } });
    } finally {
      setRunning(null);
      onDone();
    }
  }

  const { ahead, behind } = snapshot.status;
  const noRemote = snapshot.remotes.length === 0;
  const busy = running !== null;
  const tip = noRemote ? "This repository has no remote" : undefined;
  const ctx = { windowsRepo: !wslDistro(repo) && isWindowsHost, usingWslSsh: sshCommandFor(repo, settings) !== null };
  const help = result && !result.outcome.ok ? advice(result.outcome.hint, ctx) : null;

  return (
    <div className="remote-area">
      <div className="remote-bar">
        <button onClick={() => run("fetch")} disabled={busy || noRemote} title={tip ?? "Fetch all remotes (prune deleted branches)"}>
          <RefreshCw size={14} className={running?.kind === "fetch" ? "spin" : ""} /> Fetch
        </button>
        <div className="split">
          <button onClick={() => run("pull")} disabled={busy || noRemote || !snapshot.upstream} title={snapshot.upstream ? `Pull from ${snapshot.upstream} (your git config decides merge/rebase)` : "No upstream: push the branch first"}>
            <ArrowDown size={14} /> Pull
            {behind > 0 && <span className="badge-count">{behind}</span>}
          </button>
          <button className="split-more" disabled={busy || noRemote || !snapshot.upstream} onClick={() => setMenu(menu === "pull" ? null : "pull")} aria-label="Pull options">
            <ChevronDown size={13} />
          </button>
          {menu === "pull" && (
            <div className="menu" onMouseLeave={() => setMenu(null)}>
              <button onClick={() => run("pull", { mode: "ff_only" })}>Fast-forward only</button>
              <button onClick={() => run("pull", { mode: "rebase" })}>Rebase</button>
              <button onClick={() => run("pull", { mode: "merge" })}>Merge</button>
            </div>
          )}
        </div>
        <div className="split">
          <button onClick={() => run("push")} disabled={busy || noRemote || !snapshot.info.head_branch} title={snapshot.upstream ? `Push to ${snapshot.upstream}` : "Publish this branch (sets upstream)"}>
            <ArrowUp size={14} /> {snapshot.upstream ? "Push" : "Publish"}
            {ahead > 0 && <span className="badge-count">{ahead}</span>}
          </button>
          <button className="split-more" disabled={busy || noRemote || !snapshot.upstream} onClick={() => setMenu(menu === "push" ? null : "push")} aria-label="Push options">
            <ChevronDown size={13} />
          </button>
          {menu === "push" && (
            <div className="menu" onMouseLeave={() => (setMenu(null), setConfirmForce(false))}>
              <button
                className={confirmForce ? "danger" : ""}
                onClick={() => (confirmForce ? run("push", { force_with_lease: true }) : setConfirmForce(true))}
                title="Overwrites the remote branch, but refuses if someone else pushed since your last fetch"
              >
                {confirmForce ? "Click again to force push" : "Force push (with lease)…"}
              </button>
            </div>
          )}
        </div>
        <span className="upstream mono" title="Tracking branch">
          {snapshot.info.head_branch ?? "detached"} {snapshot.upstream ? `→ ${snapshot.upstream}` : "(no upstream)"}
        </span>
        <span className="spacer" />
        {running && (
          <span className="op-progress" title={running.text}>
            <Loader2 size={13} className="spin" />
            <span className="op-text">{running.text}</span>
            {running.percent !== null && <span className="mono">{running.percent}%</span>}
            <button className="icon-btn" title="Cancel" onClick={() => git.cancel(repo, running.opId).catch(() => {})}>
              <X size={13} />
            </button>
          </span>
        )}
      </div>
      {running?.percent !== null && running && <div className="op-meter" style={{ width: `${running.percent}%` }} />}
      {result && (
        <div className={"op-result " + (result.outcome.ok ? "ok" : "bad")} role="status">
          {result.outcome.ok ? <Check size={14} /> : <CircleX size={14} />}
          <div className="op-result-body">
            <span>{result.outcome.summary || (result.outcome.ok ? "Done" : "Failed")}</span>
            {help && <span className="op-help">{help}</span>}
            {details && result.outcome.log && <pre className="op-log mono">{result.outcome.log}</pre>}
          </div>
          {result.outcome.log && (
            <button className="link-btn" onClick={() => setDetails(!details)}>
              {details ? "Hide details" : "Details"}
            </button>
          )}
          <button className="icon-btn" onClick={() => setResult(null)} title="Dismiss">
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
