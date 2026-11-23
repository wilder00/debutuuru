// "Open…" actions: a folder or a file with the system dialog, "Browse in
// WSL…" (Windows: the dialog started in a distro's home), and recent
// repositories and folders of repositories (groups). Shown as the title
// bar's menu and on the welcome screen.
import { Clock, File, FolderOpen, Layers, Monitor, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { distinctNames } from "../lib/names";
import { wslDistro } from "../lib/rpc";
import { useDismiss } from "../lib/useDismiss";

export type OpenActions = {
  openFolder: () => void;
  openFile: () => void;
  browseWsl: (distro: string) => void;
  openRecent: (repo: string) => void;
  forgetRecent: (repo: string) => void;
  /** WSL distros offered for browsing (Windows only; empty elsewhere). */
  distros: string[];
  recents: string[];
  /** Folders opened as groups of tabs, most recent first. */
  recentGroups: string[];
};

type Recent = { path: string; label: string; group: boolean };

/** Recent groups first, then repositories, each named so same-named
 *  folders differ (`ssr-site · NED-2550`). */
function recentItems(a: OpenActions, groups: number, repos: number): Recent[] {
  const g = a.recentGroups.slice(0, groups);
  const r = a.recents.slice(0, repos);
  const names = distinctNames([...g, ...r]);
  return [...g.map((path) => ({ path, label: names.get(path)!, group: true })), ...r.map((path) => ({ path, label: names.get(path)!, group: false }))];
}

const where = (p: string) => (wslDistro(p) ? `WSL · ${wslDistro(p)}` : p);

/** Folder icon button in the title bar with all the open actions. */
export function OpenMenuButton({ actions }: { actions: OpenActions }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="open-menu" ref={ref}>
      <button className={"icon-btn" + (open ? " on" : "")} aria-expanded={open} title={t("open.menu")} onClick={() => setOpen(!open)}>
        <FolderOpen size={15} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={run(actions.openFolder)}>
            <FolderOpen size={14} /> {t("open.folder")} <kbd>Ctrl+O</kbd>
          </button>
          <button role="menuitem" onClick={run(actions.openFile)}>
            <File size={14} /> {t("open.file")}
          </button>
          {actions.distros.map((d) => (
            <button key={d} role="menuitem" onClick={run(() => actions.browseWsl(d))}>
              <Monitor size={14} /> {t("open.browseWsl", { distro: d })}
            </button>
          ))}
          {actions.recents.length + actions.recentGroups.length > 0 && <div className="menu-label">{t("open.recent")}</div>}
          {recentItems(actions, 4, 8).map((r) => (
            <button key={r.path} role="menuitem" title={r.group ? `${r.path}\n${t("open.groupHint")}` : r.path} onClick={run(() => actions.openRecent(r.path))}>
              {r.group ? <Layers size={14} /> : <Clock size={14} />} {r.label}
              <span className="menu-aside">{where(r.path)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Welcome screen: the same actions as buttons, and the recent list. */
export function OpenPanel({ actions }: { actions: OpenActions }) {
  const { t } = useTranslation();
  return (
    <div className="open-panel">
      <div className="open-buttons">
        <button className="primary" onClick={actions.openFolder}>
          <FolderOpen size={14} /> {t("open.folder")}
        </button>
        <button onClick={actions.openFile}>
          <File size={14} /> {t("open.file")}
        </button>
        {actions.distros.map((d) => (
          <button key={d} onClick={() => actions.browseWsl(d)}>
            <Monitor size={14} /> {t("open.browseWsl", { distro: d })}
          </button>
        ))}
      </div>
      {actions.recents.length + actions.recentGroups.length > 0 && (
        <div className="recent-list">
          <div className="menu-label">{t("open.recent")}</div>
          <ul>
            {recentItems(actions, 5, 10).map(({ path: r, label, group }) => (
              <li key={r} className="item recent-item" title={group ? `${r}\n${t("open.groupHint")}` : r} onClick={() => actions.openRecent(r)}>
                {group ? <Layers size={13} /> : <Clock size={13} />}
                <span className="label">{label}</span>
                <span className="aside">{where(r)}</span>
                <button
                  className="icon-btn hover-only"
                  title={t("open.forget")}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.forgetRecent(r);
                  }}
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
