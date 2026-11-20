import { AlertTriangle, FolderOpen, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Hello } from "./bindings/Hello";
import type { Snapshot } from "./bindings/Snapshot";
import { AgentError, agentHello, initialPath, onOpenRepo, resolvePath } from "./lib/rpc";
import { GitView } from "./modules/git/GitView";
import { AppearancePanel } from "./settings/AppearancePanel";
import { BackgroundLayer } from "./settings/BackgroundLayer";
import { useSettings } from "./settings/SettingsProvider";
import { ActivityBar } from "./shell/ActivityBar";
import { StatusBar } from "./shell/StatusBar";
import { TabBar } from "./shell/TabBar";
import { TitleBar } from "./shell/TitleBar";

export function App() {
  const { ready, session, updateSession, notice, dismissNotice } = useSettings();
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<Hello | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const repos = session.open_repos;
  const active = session.active;

  // Latest session for callbacks that outlive a render (event listeners).
  const sessionRef = useRef(session);
  sessionRef.current = session;

  /** Opens (or focuses) a repo tab. Paths are canonicalized first so the same
   *  repo typed two ways doesn't get two tabs. */
  const open = useCallback(
    async (path: string) => {
      const p = path.trim();
      if (!p) return;
      const key = await resolvePath(p);
      const s = sessionRef.current;
      setError(null);
      updateSession({ open_repos: s.open_repos.includes(key) ? s.open_repos : [...s.open_repos, key], active: key });
    },
    [updateSession],
  );

  const close = useCallback(
    (repo: string) => {
      const s = sessionRef.current;
      const i = s.open_repos.indexOf(repo);
      const open_repos = s.open_repos.filter((r) => r !== repo);
      const nextActive = s.active === repo ? (open_repos[Math.min(i, open_repos.length - 1)] ?? null) : s.active;
      updateSession({ open_repos, active: nextActive });
      setSnapshots(({ [repo]: _, ...rest }) => rest);
    },
    [updateSession],
  );

  // After settings (restored tabs) are loaded: open the path given on the
  // command line, and listen for paths from later `debutuuru .` calls.
  useEffect(() => {
    if (!ready) return;
    initialPath()
      .then((p) => (p ? open(p) : undefined))
      .catch(() => {});
    const un = onOpenRepo((p) => void open(p));
    return () => void un.then((f) => f());
  }, [ready, open]);

  // Status bar shows the agent serving the active tab (local or WSL).
  useEffect(() => {
    agentHello(active ?? "")
      .then(setAgent)
      .catch(() => setAgent(null));
  }, [active, snapshots[active ?? ""] === undefined]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F5") {
        e.preventDefault();
        setRefreshKey((k) => k + 1);
      } else if (e.key === "," && e.ctrlKey) {
        e.preventDefault();
        setAppearanceOpen(true);
      } else if (e.key === "w" && e.ctrlKey && sessionRef.current.active) {
        e.preventDefault();
        close(sessionRef.current.active);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const onError = useCallback((e: unknown) => setError(e instanceof AgentError ? e.message : String(e)), []);
  const onLoaded = useCallback((repo: string, s: Snapshot) => {
    setSnapshots((prev) => ({ ...prev, [repo]: s }));
    if (repo === sessionRef.current.active) setError(null);
  }, []);

  const snapshot = active ? (snapshots[active] ?? null) : null;
  const banner = error ?? notice;
  return (
    <>
      <BackgroundLayer />
      <div className="app">
        <TitleBar repo={active} info={snapshot?.info ?? null} onOpen={open} onRefresh={() => setRefreshKey((k) => k + 1)} />
        <div className="body">
          <ActivityBar onAppearance={() => setAppearanceOpen(true)} />
          <div className="workspace">
            <TabBar repos={repos} active={active} onSelect={(r) => updateSession({ ...sessionRef.current, active: r })} onClose={close} />
            {banner && (
              <div className={"banner " + (error ? "danger" : "warn")} role="alert">
                <AlertTriangle size={14} />
                <span>{banner}</span>
                <button className="icon-btn" onClick={() => (error ? setError(null) : dismissNotice())} title="Dismiss">
                  <X size={14} />
                </button>
              </div>
            )}
            {repos.map((r) => (
              <GitView key={r} repo={r} active={r === active} refreshKey={refreshKey} onError={onError} onOpen={open} onLoaded={onLoaded} />
            ))}
            {repos.length === 0 && <Welcome />}
          </div>
        </div>
        <StatusBar snapshot={snapshot} agent={agent} />
      </div>
      {appearanceOpen && <AppearancePanel onClose={() => setAppearanceOpen(false)} />}
    </>
  );
}

function Welcome() {
  return (
    <div className="empty welcome">
      <div className="welcome-card panel">
        <FolderOpen size={28} />
        <h1>Open a repository</h1>
        <p>Type a path in the bar above (Windows or <code className="mono">\\wsl.localhost\…</code>), or from any terminal run</p>
        <code className="mono">debutuuru .</code>
        <p className="hint">Ctrl+, Appearance · F5 refresh · Ctrl+W close tab</p>
      </div>
    </div>
  );
}
