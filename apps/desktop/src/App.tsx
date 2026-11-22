import { getCurrentWebview } from "@tauri-apps/api/webview";
import { AlertTriangle, FolderOpen, FolderInput, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { Hello } from "./bindings/Hello";
import type { Snapshot } from "./bindings/Snapshot";
import { emit } from "./lib/bus";
import { isWindowsHost, locateFile, pathKind, pickFile, pickFolder, userDistros, wslHome } from "./lib/open";
import { AgentError, agentHello, agentPathToRepo, initialPath, onOpenRepo, openToolWindow, resolvePath, wslDistros } from "./lib/rpc";
import { git } from "./modules/git/api";
import { GroupPicker, PICK_FROM } from "./shell/GroupPicker";
import type { Session } from "./bindings/Session";
import { checkForUpdate } from "./lib/updater";
import { GitView } from "./modules/git/GitView";
import { PromptDialog } from "./modules/git/PromptDialog";
import { AppearancePanel } from "./settings/AppearancePanel";
import { BackgroundLayer } from "./settings/BackgroundLayer";
import { useSettings } from "./settings/SettingsProvider";
import { ActivityBar } from "./shell/ActivityBar";
import { CircuitTraces } from "./shell/CircuitTraces";
import { useCommands } from "./shell/commands";
import { OpenMenuButton, OpenPanel, type OpenActions } from "./shell/OpenMenu";
import { Palette } from "./shell/Palette";

// xterm.js loads the first time the terminal opens.
const TerminalPanel = lazy(() => import("./modules/term/TerminalPanel").then((m) => ({ default: m.TerminalPanel })));
import { StatusBar } from "./shell/StatusBar";
import { TabBar } from "./shell/TabBar";
import { TitleBar } from "./shell/TitleBar";

export function App() {
  const { t } = useTranslation();
  const { ready, session, updateSession, notice, dismissNotice, updates, layout, updateLayout } = useSettings();
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<Hello | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  /** Open palette and its starting text ("" files, ">" commands). */
  const [palette, setPalette] = useState<string | null>(null);
  // Terminal panel: mounted the first time it opens, then only hidden, so
  // its terminals keep running.
  const [termOpen, setTermOpen] = useState(false);
  const [termMounted, setTermMounted] = useState(false);
  const [termMax, setTermMax] = useState(false);
  const toggleTerminal = useCallback(() => {
    setTermMounted(true);
    setTermOpen((o) => !o);
  }, []);
  const toggleTerminalMax = useCallback(() => {
    setTermMounted(true);
    setTermOpen(true);
    setTermMax((m) => !m);
  }, []);
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

  /** Opens the repositories found in `folder` as one group of tabs, kept
   *  together; a repo belongs to one group at most. */
  const openGroup = useCallback(
    (folder: string, members: string[]) => {
      const s = sessionRef.current;
      const existing = s.groups.find((g) => g.folder === folder);
      const repos = [...new Set([...(existing?.repos ?? []), ...members])];
      const inGroup = (r: string) => repos.includes(r);
      // Where the group goes: where its first open tab is, else at the end.
      const first = s.open_repos.findIndex(inGroup);
      const rest = s.open_repos.filter((r) => !inGroup(r));
      const at = first < 0 ? rest.length : s.open_repos.slice(0, first).filter((r) => !inGroup(r)).length;
      const groups = s.groups
        .filter((g) => g.folder !== folder)
        .map((g) => ({ ...g, repos: g.repos.filter((r) => !inGroup(r)) }))
        .filter((g) => g.repos.length > 0);
      setError(null);
      updateSession({
        ...s,
        open_repos: [...rest.slice(0, at), ...repos, ...rest.slice(at)],
        active: s.active && inGroup(s.active) ? s.active : members[0],
        groups: [...groups, { folder, repos, collapsed: false }],
        recent_groups: [folder, ...s.recent_groups.filter((r) => r !== folder)].slice(0, 20),
      });
    },
    [updateSession],
  );
  /** Folder with many repositories, waiting for the user to pick. */
  const [picking, setPicking] = useState<{ folder: string; repos: string[] } | null>(null);

  /** Opens (or focuses) a repo tab. Paths are canonicalized first so the same
   *  repo typed two ways doesn't get two tabs. A folder that isn't a
   *  repository opens the repositories inside it as a group. */
  const open = useCallback(
    async (path: string) => {
      const p = path.trim();
      if (!p) return;
      const key = await resolvePath(p);
      let found = null;
      try {
        found = await git.findRepos(key);
      } catch {
        // Agents older than git module v10: open it as a repository.
      }
      if (found && !found.inside_repo) {
        if (found.repos.length === 0) {
          setError(t("open.noRepos", { folder: key }));
          return;
        }
        const members = await Promise.all(found.repos.map((r) => resolvePath(agentPathToRepo(key, r))));
        if (members.length > PICK_FROM) setPicking({ folder: key, repos: members });
        else openGroup(key, members);
        return;
      }
      const s = sessionRef.current;
      setError(null);
      updateSession({
        ...s,
        open_repos: s.open_repos.includes(key) ? s.open_repos : [...s.open_repos, key],
        active: key,
        recent_repos: [key, ...s.recent_repos.filter((r) => r !== key)].slice(0, 20),
      });
    },
    [updateSession, openGroup, t],
  );

  /** A folder opens as a tab; a file opens its repository and shows the
   *  file in Files (dialogs, drag and drop). */
  const openAny = useCallback(
    async (path: string) => {
      try {
        if ((await pathKind(path)) !== "file") return await open(path);
        const { repo, path: rel } = await locateFile(path);
        await open(repo);
        emit("open-file", { repo, path: rel });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [open],
  );

  const [distros, setDistros] = useState<string[]>([]);
  useEffect(() => {
    if (isWindowsHost) wslDistros().then((d) => setDistros(userDistros(d)), () => {});
  }, []);

  /** Dialog result: null when cancelled. */
  const openPicked = useCallback((p: string | null) => {
    if (p) void openAny(p);
  }, [openAny]);

  const openActions: OpenActions = useMemo(
    () => ({
      openFolder: () => void pickFolder().then(openPicked, (e) => setError(String(e))),
      openFile: () => void pickFile().then(openPicked, (e) => setError(String(e))),
      browseWsl: (distro) =>
        void wslHome(distro)
          .then((home) => pickFolder(home))
          .then(openPicked, (e) => setError(e instanceof Error ? e.message : String(e))),
      openRecent: (r) => void open(r).catch((e) => setError(e instanceof Error ? e.message : String(e))),
      forgetRecent: (r) => {
        const s = sessionRef.current;
        updateSession({ ...s, recent_repos: s.recent_repos.filter((x) => x !== r), recent_groups: s.recent_groups.filter((x) => x !== r) });
      },
      distros,
      recents: session.recent_repos,
      recentGroups: session.recent_groups,
    }),
    [openPicked, open, distros, session.recent_repos, session.recent_groups, updateSession],
  );

  const openActionsRef = useRef(openActions);
  openActionsRef.current = openActions;

  // Drag and drop: folders open as tabs, files open in their repository.
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter" || p.type === "over") setDragging(true);
      else if (p.type === "leave") setDragging(false);
      else if (p.type === "drop") {
        setDragging(false);
        void (async () => {
          for (const path of p.paths) await openAny(path);
        })();
      }
    });
    return () => void un.then((f) => f());
  }, [openAny]);

  /** Closes tabs; their groups lose them, and empty groups go away. */
  const closeMany = useCallback(
    (gone: string[]) => {
      const s = sessionRef.current;
      const i = s.open_repos.findIndex((r) => gone.includes(r));
      const open_repos = s.open_repos.filter((r) => !gone.includes(r));
      const nextActive = s.active && gone.includes(s.active) ? (open_repos[Math.min(i, open_repos.length - 1)] ?? null) : s.active;
      const groups = s.groups.map((g) => ({ ...g, repos: g.repos.filter((r) => !gone.includes(r)) })).filter((g) => g.repos.length > 0);
      updateSession({ ...s, open_repos, active: nextActive, groups });
      setSnapshots((prev) => Object.fromEntries(Object.entries(prev).filter(([r]) => !gone.includes(r))));
    },
    [updateSession],
  );
  const close = useCallback((repo: string) => closeMany([repo]), [closeMany]);
  const closeGroup = useCallback(
    (folder: string) => closeMany(sessionRef.current.groups.find((g) => g.folder === folder)?.repos ?? []),
    [closeMany],
  );
  const toggleGroup = useCallback(
    (folder: string) => {
      const s: Session = sessionRef.current;
      updateSession({ ...s, groups: s.groups.map((g) => (g.folder === folder ? { ...g, collapsed: !g.collapsed } : g)) });
    },
    [updateSession],
  );

  // After settings (restored tabs) are loaded: open the path given on the
  // command line, and listen for paths from later `debutuuru .` calls.
  useEffect(() => {
    if (!ready) return;
    const report = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
    initialPath()
      .then((p) => (p ? open(p) : undefined))
      .catch(report);
    const un = onOpenRepo((p) => void open(p).catch(report));
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
      // Ctrl+` (the key left of 1, whatever the layout) shows/hides the terminal.
      if ((e.ctrlKey || e.metaKey) && e.code === "Backquote") {
        e.preventDefault();
        toggleTerminal();
        return;
      }
      // Inside a terminal, Ctrl+P, Ctrl+W, Ctrl+O, F5… belong to the shell;
      // only Ctrl+Shift+P and Ctrl+, stay with the app.
      const inTerminal = e.target instanceof Element && !!e.target.closest(".xterm");
      if (inTerminal && !((e.ctrlKey || e.metaKey) && ((e.shiftKey && e.key.toLowerCase() === "p") || e.key === ","))) return;
      // Ctrl+P / Ctrl+Shift+P (Cmd on macOS), like VS Code. Also stops
      // WebView2's own Ctrl+P (print).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        setPalette(e.shiftKey ? ">" : "");
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openActionsRef.current.openFolder();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === "KeyU") {
        // Like VS Code's Output panel: the log window.
        e.preventDefault();
        void openToolWindow("logs");
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyB") {
        // Like VS Code: Ctrl+B the left panel, Ctrl+Alt+B the right one.
        e.preventDefault();
        const l = layoutRef.current;
        updateLayout(e.altKey ? { changes: !l.changes } : { sidebar: !l.sidebar });
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
  }, [close, toggleTerminal, updateLayout]);

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
    open: openActions,
    terminal: { toggle: toggleTerminal, toggleMax: toggleTerminalMax, newTerminal: () => {
      setTermMounted(true);
      setTermOpen(true);
      setTimeout(() => emit("new-terminal", { repo: "" }), 0);
    } },
    openPalette: setPalette,
    openSettings: () => setAppearanceOpen(true),
    refresh: () => setRefreshKey((k) => k + 1),
    closeTab: close,
    groups: session.groups,
    closeGroup,
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
        <TitleBar repo={active} info={snapshot?.info ?? null} onOpen={open} onRefresh={() => setRefreshKey((k) => k + 1)} openMenu={<OpenMenuButton actions={openActions} />} />
        <div className="body">
          <ActivityBar onAppearance={() => setAppearanceOpen(true)} onTerminal={toggleTerminal} terminalOpen={termOpen} />
          <div className={"workspace" + (termOpen && termMax ? " terminal-only" : "")}>
            <TabBar
              repos={repos}
              active={active}
              groups={session.groups}
              onSelect={(r) => updateSession({ ...sessionRef.current, active: r })}
              onClose={close}
              onToggleGroup={toggleGroup}
              onCloseGroup={closeGroup}
            />
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
            {repos.length === 0 && <Welcome actions={openActions} />}
            {termMounted && (
              <Suspense fallback={null}>
                <TerminalPanel
                  repo={active}
                  open={termOpen}
                  maximized={termMax}
                  onToggleMax={toggleTerminalMax}
                  onHide={() => {
                    setTermOpen(false);
                    setTermMax(false);
                  }}
                />
              </Suspense>
            )}
          </div>
        </div>
        <StatusBar snapshot={snapshot} agent={agent} />
      </div>
      {appearanceOpen && <AppearancePanel onClose={() => setAppearanceOpen(false)} />}
      <PromptDialog />
      {picking && (
        <GroupPicker
          folder={picking.folder}
          repos={picking.repos}
          onCancel={() => setPicking(null)}
          onOpen={(chosen) => {
            setPicking(null);
            openGroup(picking.folder, chosen);
          }}
        />
      )}
      {dragging && (
        <div className="drop-overlay">
          <CircuitTraces />
          <div className="drop-card">
            <FolderInput size={28} />
            <span>{t("open.drop")}</span>
          </div>
        </div>
      )}
      {palette !== null && (
        <Palette key={palette} initial={palette} repo={active} commands={commands} onOpenFile={openFile} onClose={closePalette} />
      )}
    </>
  );
}

function Welcome({ actions }: { actions: OpenActions }) {
  const { t } = useTranslation();
  return (
    <div className="empty welcome">
      <CircuitTraces />
      <div className="welcome-card panel">
        <FolderOpen size={28} />
        <h1>{t("app.welcomeTitle")}</h1>
        <p>
          <Trans i18nKey="app.welcomeBody" values={{ wslPath: String.raw`\\wsl.localhost\…` }} components={{ code: <code className="mono" /> }} />
        </p>
        <code className="mono">debutuuru .</code>
        <OpenPanel actions={actions} />
        <p className="hint">{t("app.welcomeShortcuts")}</p>
        <p className="hint">{t("app.welcomePalette")}</p>
      </div>
    </div>
  );
}
