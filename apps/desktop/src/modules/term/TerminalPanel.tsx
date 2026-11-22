// The terminal panel under the workspace: tabs of terminals, "+" for the
// default profile and a menu for the others, maximize (the terminal takes the
// whole window) and hide. Its top edge drags to resize. Terminals keep running
// while the panel is hidden. Each tab shows its profile's icon; double-click
// its name to rename it.
import { ChevronDown, Maximize2, Minimize2, Plus, SquareTerminal, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TerminalProfile } from "../../bindings/TerminalProfile";
import { useBus } from "../../lib/bus";
import { useDismiss } from "../../lib/useDismiss";
import { useSettings } from "../../settings/SettingsProvider";
import { ProfileIcon } from "./icons";
import { detectedProfiles, pickDefault } from "./profiles";
import { TerminalView } from "./TerminalView";

type Tab = { key: number; profile: TerminalProfile; repo: string | null; exited: boolean; /** Name the user gave it. */ title: string | null };

type Props = {
  /** Repository new terminals start in. */
  repo: string | null;
  open: boolean;
  maximized: boolean;
  onToggleMax: () => void;
  onHide: () => void;
};

let nextKey = 1;

export function TerminalPanel({ repo, open, maximized, onToggleMax, onHide }: Props) {
  const { t } = useTranslation();
  const { terminal, updateTerminal } = useSettings();
  const [detected, setDetected] = useState<TerminalProfile[] | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
  const menuRef = useDismiss<HTMLDivElement>(menu, () => setMenu(false));
  const profiles = [...(detected ?? []), ...terminal.profiles];

  useEffect(() => {
    void detectedProfiles().then(setDetected);
  }, []);

  const add = useCallback(
    (profile: TerminalProfile | null) => {
      if (!profile) return;
      const tab = { key: nextKey++, profile, repo, exited: false, title: null };
      setTabs((ts) => [...ts, tab]);
      setActive(tab.key);
    },
    [repo],
  );

  // First time the panel opens: one terminal with the default profile.
  const started = useRef(false);
  useEffect(() => {
    if (!open || started.current || detected === null) return;
    started.current = true;
    if (tabs.length === 0) add(pickDefault(profiles, terminal.default_profile));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, detected]);

  const close = (key: number) => {
    setTabs((ts) => {
      const i = ts.findIndex((x) => x.key === key);
      const rest = ts.filter((x) => x.key !== key);
      if (active === key) setActive(rest[Math.min(i, rest.length - 1)]?.key ?? null);
      if (!rest.length) {
        started.current = false;
        onHide();
      }
      return rest;
    });
  };

  const rename = (key: number, title: string) => {
    setTabs((ts) => ts.map((x) => (x.key === key ? { ...x, title: title.trim() || null } : x)));
    setRenaming(null);
  };

  // From the palette: a new terminal (any repo tab may ask).
  useBus("new-terminal", "", () => add(pickDefault(profiles, terminal.default_profile)));

  // Drag the top edge to resize (not while maximized).
  const onResizeStart = (e: React.PointerEvent) => {
    if (maximized) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = terminal.panel_height;
    const panel = (e.currentTarget as HTMLElement).parentElement!;
    const move = (ev: PointerEvent) => {
      const h = Math.max(120, Math.min(window.innerHeight - 160, startH + startY - ev.clientY));
      panel.style.height = `${h}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      updateTerminal({ panel_height: Math.round(panel.getBoundingClientRect().height) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <section
      className={"terminal-panel" + (maximized ? " maximized" : "")}
      hidden={!open}
      style={maximized ? undefined : { height: terminal.panel_height }}
      aria-label={t("term.title")}
    >
      <div className="terminal-resize" onPointerDown={onResizeStart} />
      <header className="terminal-head">
        <SquareTerminal size={14} className="terminal-icon" />
        <div className="terminal-tabs" role="tablist">
          {tabs.map((tab) => (
            <div
              key={tab.key}
              role="tab"
              aria-selected={tab.key === active}
              className={"terminal-tab" + (tab.key === active ? " on" : "") + (tab.exited ? " exited" : "")}
              onClick={() => setActive(tab.key)}
              onAuxClick={(e) => e.button === 1 && close(tab.key)}
              onDoubleClick={() => setRenaming(tab.key)}
              title={tab.title ? `${tab.title} · ${tab.profile.name}` : `${tab.profile.name} · ${t("term.renameHint")}`}
            >
              <ProfileIcon profile={tab.profile} />
              {renaming === tab.key ? (
                <input
                  className="tab-rename"
                  autoFocus
                  defaultValue={tab.title ?? tab.profile.name}
                  aria-label={t("term.rename")}
                  onFocus={(e) => e.currentTarget.select()}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => rename(tab.key, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") rename(tab.key, e.currentTarget.value);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <span className="label">{tab.title ?? tab.profile.name}</span>
              )}
              <button
                className="icon-btn"
                title={t("term.close")}
                onClick={(e) => {
                  e.stopPropagation();
                  close(tab.key);
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="split terminal-new" ref={menuRef}>
          <button className="icon-btn" title={t("term.new")} onClick={() => add(pickDefault(profiles, terminal.default_profile))} disabled={!profiles.length}>
            <Plus size={14} />
          </button>
          <button className="icon-btn" title={t("term.newWith")} aria-expanded={menu} onClick={() => setMenu(!menu)} disabled={!profiles.length}>
            <ChevronDown size={13} />
          </button>
          {menu && (
            <div className="menu" role="menu">
              {profiles.map((p) => (
                <button
                  key={p.id}
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    add(p);
                  }}
                >
                  <ProfileIcon profile={p} />
                  {p.name}
                  {p.id === pickDefault(profiles, terminal.default_profile)?.id && <span className="menu-aside">{t("term.default")}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="spacer" />
        <button className="icon-btn" onClick={onToggleMax} title={maximized ? t("term.restore") : t("term.maximize")}>
          {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button className="icon-btn" onClick={onHide} title={t("term.hide")}>
          <ChevronDown size={15} />
        </button>
      </header>
      <div className="terminal-body">
        {detected === null && <div className="empty-line">{t("common.loading")}</div>}
        {detected !== null && !profiles.length && <div className="empty-line">{t("term.noProfiles")}</div>}
        {tabs.map((tab) => (
          <TerminalView
            key={tab.key}
            profile={tab.profile}
            repo={tab.repo}
            active={open && tab.key === active}
            onExit={() => setTabs((ts) => ts.map((x) => (x.key === tab.key ? { ...x, exited: true } : x)))}
          />
        ))}
      </div>
    </section>
  );
}
