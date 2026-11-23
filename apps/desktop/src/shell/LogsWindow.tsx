// The log window: every request the UI sends to an agent and every git
// command the agents run, live, with its output. Logging only happens while
// this window is open (the shell turns it on and off), so a closed window
// costs nothing. Lines arrive in bursts (a refresh runs a dozen commands), so
// they are batched per animation frame.
import { listen } from "@tauri-apps/api/event";
import { ArrowDownToLine, Check, CircleX, Copy, Pause, Play, ScrollText, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LogLine } from "../bindings/LogLine";
import { ToolWindow } from "./ToolWindow";

/** Oldest lines are dropped past this many. */
const MAX_LINES = 5000;

type Row = LogLine & { id: number };
type KindFilter = "all" | "git" | "request";

const time = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};
const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
const quote = (a: string) => (/^[\w./:=@^~-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);
/** What the line ran: the method, or the git command as you'd type it. */
const commandText = (l: LogLine) => (l.detail.kind === "git" ? `git ${l.detail.args.map(quote).join(" ")}` : l.detail.method);
const outputText = (l: LogLine) => (l.detail.kind === "git" ? l.detail.output : (l.detail.error ?? ""));

export function LogsWindow() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [follow, setFollow] = useState(true);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const pending = useRef<Row[]>([]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let id = 0;
    let frame = 0;
    const flush = () => {
      frame = 0;
      if (pausedRef.current || !pending.current.length) return;
      const add = pending.current;
      pending.current = [];
      setRows((r) => {
        const next = r.concat(add);
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    };
    const un = listen<LogLine>("log-entry", (e) => {
      pending.current.push({ ...e.payload, id: ++id });
      if (pending.current.length > MAX_LINES) pending.current.splice(0, pending.current.length - MAX_LINES);
      if (!frame) frame = requestAnimationFrame(flush);
    });
    return () => {
      void un.then((f) => f());
      cancelAnimationFrame(frame);
    };
  }, []);

  // Resuming shows what arrived meanwhile.
  useEffect(() => {
    if (paused || !pending.current.length) return;
    const add = pending.current;
    pending.current = [];
    setRows((r) => r.concat(add).slice(-MAX_LINES));
  }, [paused]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (kind === "all" || r.detail.kind === kind) &&
        (!errorsOnly || !r.ok) &&
        (!q || r.repo.toLowerCase().includes(q) || commandText(r).toLowerCase().includes(q) || outputText(r).toLowerCase().includes(q)),
    );
  }, [rows, filter, kind, errorsOnly]);

  useEffect(() => {
    if (follow && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [shown, follow]);

  const toggle = (id: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const copyAll = () =>
    void navigator.clipboard.writeText(
      shown
        .map((r) => {
          const out = outputText(r);
          return `${time(r.at)}  ${r.ok ? "ok " : "ERR"}  ${r.millis}ms  ${r.repo}  ${commandText(r)}${out ? `\n${out.replace(/^/gm, "    ")}` : ""}`;
        })
        .join("\n"),
    );

  const toolbar = (
    <>
      <input className="tool-filter" value={filter} placeholder={t("logs.filter")} aria-label={t("logs.filter")} spellCheck={false} onChange={(e) => setFilter(e.target.value)} />
      <select value={kind} aria-label={t("logs.kind")} onChange={(e) => setKind(e.target.value as KindFilter)}>
        <option value="all">{t("logs.kindAll")}</option>
        <option value="git">{t("logs.kindGit")}</option>
        <option value="request">{t("logs.kindRequest")}</option>
      </select>
      <label className="toggle-row inline">
        <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> {t("logs.errorsOnly")}
      </label>
      <span className="spacer" />
      <span className="hint">{t("logs.count", { count: shown.length })}</span>
      <button className={"icon-btn" + (follow ? " on" : "")} aria-pressed={follow} title={t("logs.follow")} onClick={() => setFollow(!follow)}>
        <ArrowDownToLine size={15} />
      </button>
      <button className="icon-btn" title={paused ? t("logs.resume") : t("logs.pause")} onClick={() => setPaused(!paused)}>
        {paused ? <Play size={15} /> : <Pause size={15} />}
      </button>
      <button className="icon-btn" title={t("logs.copy")} disabled={!shown.length} onClick={copyAll}>
        <Copy size={15} />
      </button>
      <button className="icon-btn" title={t("logs.clear")} disabled={!rows.length} onClick={() => (setRows([]), setOpen(new Set()))}>
        <Trash2 size={15} />
      </button>
    </>
  );

  return (
    <ToolWindow title={t("logs.title")} icon={<ScrollText size={16} />} toolbar={toolbar}>
      <div
        className="log-list mono"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          if (atEnd !== follow) setFollow(atEnd);
        }}
      >
        {!rows.length && <p className="log-empty">{paused ? t("logs.paused") : t("logs.empty")}</p>}
        {shown.map((r) => {
          const out = outputText(r);
          const expanded = open.has(r.id);
          return (
            <div key={r.id} className={"log-row" + (r.ok ? "" : " bad") + (expanded ? " open" : "")} onClick={() => out && toggle(r.id)}>
              <span className="log-time">{time(r.at)}</span>
              {r.ok ? <Check size={13} className="ok" /> : <CircleX size={13} className="danger" />}
              <span className={"log-kind " + r.detail.kind}>{r.detail.kind === "git" ? "git" : t("logs.request")}</span>
              <span className="log-repo" title={r.repo}>
                {folderName(r.repo)}
              </span>
              <span className="log-cmd" title={commandText(r)}>
                {commandText(r)}
                {r.detail.kind === "git" && r.detail.exit_code !== 0 && <span className="log-exit"> → {r.detail.exit_code ?? "?"}</span>}
              </span>
              <span className="log-ms">{r.millis} ms</span>
              {expanded && <pre className="log-output">{out}</pre>}
            </div>
          );
        })}
      </div>
    </ToolWindow>
  );
}
