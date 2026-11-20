import { AlertTriangle, FolderOpen, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Hello } from "./bindings/Hello";
import type { Snapshot } from "./bindings/Snapshot";
import { AgentError, hello, initialPath } from "./lib/rpc";
import { GitView } from "./modules/git/GitView";
import { AppearancePanel } from "./settings/AppearancePanel";
import { BackgroundLayer } from "./settings/BackgroundLayer";
import { useSettings } from "./settings/SettingsProvider";
import { ActivityBar } from "./shell/ActivityBar";
import { StatusBar } from "./shell/StatusBar";
import { TitleBar } from "./shell/TitleBar";

export function App() {
  const [repo, setRepo] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<Hello | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { notice, dismissNotice } = useSettings();

  const open = useCallback((path: string) => {
    const p = path.trim();
    if (!p) return;
    setError(null);
    setSnapshot(null);
    setRepo(p);
  }, []);

  useEffect(() => {
    hello().then(setAgent).catch(() => {});
    initialPath()
      .then((p) => p && open(p))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F5") {
        e.preventDefault();
        setRefreshKey((k) => k + 1);
      } else if (e.key === "," && e.ctrlKey) {
        e.preventDefault();
        setAppearanceOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onError = useCallback((e: unknown) => setError(e instanceof AgentError ? e.message : String(e)), []);
  const onLoaded = useCallback((s: Snapshot) => {
    setSnapshot(s);
    setError(null);
  }, []);

  const banner = error ?? notice;
  return (
    <>
      <BackgroundLayer />
      <div className="app">
        <TitleBar repo={repo} info={snapshot?.info ?? null} onOpen={open} onRefresh={() => setRefreshKey((k) => k + 1)} />
        <div className="body">
          <ActivityBar onAppearance={() => setAppearanceOpen(true)} />
          <div className="workspace">
            {banner && (
              <div className={"banner " + (error ? "danger" : "warn")} role="alert">
                <AlertTriangle size={14} />
                <span>{banner}</span>
                <button className="icon-btn" onClick={() => (error ? setError(null) : dismissNotice())} title="Dismiss">
                  <X size={14} />
                </button>
              </div>
            )}
            {repo ? (
              <GitView key={repo} repo={repo} refreshKey={refreshKey} onError={onError} onOpen={open} onLoaded={onLoaded} />
            ) : (
              <Welcome />
            )}
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
        <p>Type a path in the bar above, or from any terminal run</p>
        <code className="mono">debutuuru open .</code>
        <p className="hint">Ctrl+, opens Appearance · F5 refreshes</p>
      </div>
    </div>
  );
}
