import { AlertTriangle, FolderOpen, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { Hello } from "./bindings/Hello";
import type { Snapshot } from "./bindings/Snapshot";
import { emit } from "./lib/bus";
import { AgentError, agentHello, initialPath, onOpenRepo, resolvePath } from "./lib/rpc";
import { checkForUpdate } from "./lib/updater";
import { GitView } from "./modules/git/GitView";
import { PromptDialog } from "./modules/git/PromptDialog";
import { AppearancePanel } from "./settings/AppearancePanel";
import { BackgroundLayer } from "./settings/BackgroundLayer";
import { useSettings } from "./settings/SettingsProvider";
import { ActivityBar } from "./shell/ActivityBar";
import { useCommands } from "./shell/commands";
import { Palette } from "./shell/Palette";
import { StatusBar } from "./shell/StatusBar";
import { TabBar } from "./shell/TabBar";
import { TitleBar } from "./shell/TitleBar";

export function App() {
  const { t } = useTranslation();
  const { ready, session, updateSession, notice, dismissNotice, updates } = useSettings();
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<Hello | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  /** Open palette and its starting text ("" files, ">" commands). */
  const [palette, setPalette] = useState<string | null>(null);
  const repos = session.open_repos;
  const active = session.active;

  // Look for a new version once, shortly after start (release builds only;
  // a dev build would always look outdated). Never installs by itself.
  useEffect(() => {
    if (!ready || !updates.check_on_start || import.meta.env.DEV) return;
    const t = setTimeout(() => checkForUpdate(true), 5000);
    return () => clearTimeout(t);
  }, [ready]);

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
      // Ctrl+P / Ctrl+Shift+P (Cmd on macOS), like VS Code. Also stops
      // WebView2's own Ctrl+P (print).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        setPalette(e.shiftKey ? ">" : "");
      } else if (e.key === "F5") {
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
    // Capture phase: works while the code viewer or an input has focus.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);

  const onError = useCallback((e: unknown) => setError(e instanceof AgentError ? e.message : String(e)), []);
  const onLoaded = useCallback((repo: string, s: Snapshot) => {
    setSnapshots((prev) => ({ ...prev, [repo]: s }));
    if (repo === sessionRef.current.active) setError(null);
  }, []);

  const snapshot = active ? (snapshots[active] ?? null) : null;
  const banner = error ?? notice;
  const commands = useCommands({
    repos,
    active,
    snapshot,
    openPalette: setPalette,
    openSettings: () => setAppearanceOpen(true),
    refresh: () => setRefreshKey((k) => k + 1),
    closeTab: close,
    selectTab: (r) => updateSession({ ...sessionRef.current, active: r }),
    focusRepoInput: () => {
      const input = document.querySelector<HTMLInputElement>(".repo-picker input");
      input?.focus();
      input?.select();
    },
  });
  const closePalette = useCallback(() => setPalette(null), []);
  const openFile = useCallback((path: string) => active && emit("open-file", { repo: active, path }), [active]);
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
                <button className="icon-btn" onClick={() => (error ? setError(null) : dismissNotice())} title={t("common.dismiss")}>
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
      <PromptDialog />
      {palette !== null && (
        <Palette key={palette} initial={palette} repo={active} commands={commands} onOpenFile={openFile} onClose={closePalette} />
      )}
    </>
  );
}

function Welcome() {
  const { t } = useTranslation();
  return (
    <div className="empty welcome">
      <div className="welcome-card panel">
        <FolderOpen size={28} />
        <h1>{t("app.welcomeTitle")}</h1>
        <p>
          <Trans i18nKey="app.welcomeBody" values={{ wslPath: String.raw`\\wsl.localhost\…` }} components={{ code: <code className="mono" /> }} />
        </p>
        <code className="mono">debutuuru .</code>
        <p className="hint">{t("app.welcomeShortcuts")}</p>
        <p className="hint">{t("app.welcomePalette")}</p>
      </div>
    </div>
  );
}
