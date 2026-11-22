import { ArrowDown, ArrowUp, Check, ChevronDown, CircleX, Loader2, RefreshCw, X } from "lucide-react";
import type { TFunction } from "i18next";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FailureHint } from "../../bindings/FailureHint";
import type { GitSettings } from "../../bindings/GitSettings";
import type { OpOutcome } from "../../bindings/OpOutcome";
import type { ProgressEvent } from "../../bindings/ProgressEvent";
import type { PullMode } from "../../bindings/PullMode";
import type { Snapshot } from "../../bindings/Snapshot";
import { useBus } from "../../lib/bus";
import { useDismiss } from "../../lib/useDismiss";
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
function advice(t: TFunction, hint: FailureHint | null, ctx: { windowsRepo: boolean; usingWslSsh: boolean }): string | null {
  switch (hint) {
    case "ssh_auth":
      return ctx.windowsRepo && !ctx.usingWslSsh ? t("git.remote.advice.sshAuthWindows") : t("git.remote.advice.sshAuth");
    case "host_key":
      return t("git.remote.advice.hostKey");
    case "https_auth":
      return t("git.remote.advice.httpsAuth");
    case "rejected":
      return t("git.remote.advice.rejected");
    case "diverged":
      return t("git.remote.advice.diverged");
    case "local_changes":
      return t("git.remote.advice.localChanges");
    case "conflict":
      return t("git.remote.advice.conflict");
    case "network":
      return t("git.remote.advice.network");
    default:
      return null;
  }
}

/** The outcome's one-line summary in the UI language. Agents older than git
 *  module v5 send no `message`, and git's own errors have none: those keep
 *  the agent's (English) or git's text. */
function summaryText(t: TFunction, o: OpOutcome): string {
  const m = o.message;
  if (!m) return o.summary || (o.ok ? t("git.remote.done") : t("git.remote.failed"));
  switch (m.kind) {
    case "fetched":
      return m.remote ? t("git.remote.outcome.fetched", { remote: m.remote }) : t("git.remote.outcome.fetchedAll");
    case "pulled":
      return t("git.remote.outcome.pulled", { upstream: m.upstream });
    case "pushed":
      return t("git.remote.outcome.pushed", { branch: m.branch, target: m.target });
    default:
      return t(`git.remote.outcome.${m.kind}`);
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
  const { t } = useTranslation();
  const runningRef = useRef<Running | null>(null);
  const pullMenu = useDismiss<HTMLDivElement>(menu === "pull", () => setMenu(null));
  const pushMenu = useDismiss<HTMLDivElement>(menu === "push", () => (setMenu(null), setConfirmForce(false)));
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

  // Fetch / pull / push from the command palette (ignored while one runs).
  useBus("git-op", repo, (e) => {
    if (runningRef.current) return;
    void run(e.op, e.op === "pull" ? { mode: e.mode } : {});
  });

  async function run(kind: Kind, extra: { mode?: PullMode; force_with_lease?: boolean } = {}) {
    setMenu(null);
    setConfirmForce(false);
    setResult(null);
    setDetails(false);
    const opId = `${kind}-${Date.now()}`;
    setRunning({ kind, opId, text: t("git.remote.starting"), percent: null });
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
      setResult({ kind, outcome: { ok: false, summary: e instanceof Error ? e.message : String(e), hint: null, log: "", message: null } });
    } finally {
      setRunning(null);
      onDone();
    }
  }

  const { ahead, behind } = snapshot.status;
  const noRemote = snapshot.remotes.length === 0;
  const busy = running !== null;
  const tip = noRemote ? t("git.remote.noRemote") : undefined;
  const ctx = { windowsRepo: !wslDistro(repo) && isWindowsHost, usingWslSsh: sshCommandFor(repo, settings) !== null };
  const help = result && !result.outcome.ok ? advice(t, result.outcome.hint, ctx) : null;

  return (
    <div className="remote-area">
      <div className="remote-bar">
        <button onClick={() => run("fetch")} disabled={busy || noRemote} title={tip ?? t("git.remote.fetchTitle")}>
          <RefreshCw size={14} className={running?.kind === "fetch" ? "spin" : ""} /> {t("git.remote.fetch")}
        </button>
        <div className="split" ref={pullMenu}>
          <button onClick={() => run("pull")} disabled={busy || noRemote || !snapshot.upstream} title={snapshot.upstream ? t("git.remote.pullTitle", { upstream: snapshot.upstream }) : t("git.remote.noUpstream")}>
            <ArrowDown size={14} /> {t("git.remote.pull")}
            {behind > 0 && <span className="badge-count">{behind}</span>}
          </button>
          <button className="split-more" disabled={busy || noRemote || !snapshot.upstream} onClick={() => setMenu(menu === "pull" ? null : "pull")} aria-label={t("git.remote.pullOptions")}>
            <ChevronDown size={13} />
          </button>
          {menu === "pull" && (
            <div className="menu">
              <button onClick={() => run("pull", { mode: "ff_only" })}>{t("git.remote.ffOnly")}</button>
              <button onClick={() => run("pull", { mode: "rebase" })}>{t("git.remote.rebase")}</button>
              <button onClick={() => run("pull", { mode: "merge" })}>{t("git.remote.merge")}</button>
            </div>
          )}
        </div>
        <div className="split" ref={pushMenu}>
          <button onClick={() => run("push")} disabled={busy || noRemote || !snapshot.info.head_branch} title={snapshot.upstream ? t("git.remote.pushTitle", { upstream: snapshot.upstream }) : t("git.remote.publishTitle")}>
            <ArrowUp size={14} /> {snapshot.upstream ? t("git.remote.push") : t("git.remote.publish")}
            {ahead > 0 && <span className="badge-count">{ahead}</span>}
          </button>
          <button className="split-more" disabled={busy || noRemote || !snapshot.upstream} onClick={() => setMenu(menu === "push" ? null : "push")} aria-label={t("git.remote.pushOptions")}>
            <ChevronDown size={13} />
          </button>
          {menu === "push" && (
            <div className="menu">
              <button
                className={confirmForce ? "danger" : ""}
                onClick={() => (confirmForce ? run("push", { force_with_lease: true }) : setConfirmForce(true))}
                title={t("git.remote.forceTitle")}
              >
                {confirmForce ? t("git.remote.forceConfirm") : t("git.remote.force")}
              </button>
            </div>
          )}
        </div>
        <span className="upstream mono" title={t("git.remote.tracking")}>
          {snapshot.info.head_branch ?? t("common.detached")} {snapshot.upstream ? `→ ${snapshot.upstream}` : t("git.remote.noUpstreamShort")}
        </span>
        <span className="spacer" />
        {running && (
          <span className="op-progress" title={running.text}>
            <Loader2 size={13} className="spin" />
            <span className="op-text">{running.text}</span>
            {running.percent !== null && <span className="mono">{running.percent}%</span>}
            <button className="icon-btn" title={t("common.cancel")} onClick={() => git.cancel(repo, running.opId).catch(() => {})}>
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
            <span>{summaryText(t, result.outcome)}</span>
            {help && <span className="op-help">{help}</span>}
            {details && result.outcome.log && <pre className="op-log mono">{result.outcome.log}</pre>}
          </div>
          {result.outcome.log && (
            <button className="link-btn" onClick={() => setDetails(!details)}>
              {details ? t("git.remote.hideDetails") : t("git.remote.details")}
            </button>
          )}
          <button className="icon-btn" onClick={() => setResult(null)} title={t("common.dismiss")}>
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
