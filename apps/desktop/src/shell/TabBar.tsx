// One tab per open repository; Windows and WSL repos can be mixed. Repos
// opened from one folder (a ticket's worktrees) sit together behind a
// colored chip with the folder's name: click it to collapse or expand the
// group, its × closes all of them. Same-named tabs get their parent folder
// (`ssr-site · NED-2550`).
import { ChevronRight, Layers, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TabGroup } from "../bindings/TabGroup";
import { distinctNames } from "../lib/names";
import { repoName, wslDistro } from "../lib/rpc";
import { FxBar } from "./FxBar";

type Props = {
  repos: string[];
  active: string | null;
  groups: TabGroup[];
  onSelect: (repo: string) => void;
  onClose: (repo: string) => void;
  onToggleGroup: (folder: string) => void;
  onCloseGroup: (folder: string) => void;
};

/** Group colors cycle through the graph's lane colors. */
const LANES = 8;

export function TabBar({ repos, active, groups, onSelect, onClose, onToggleGroup, onCloseGroup }: Props) {
  const { t } = useTranslation();
  if (repos.length === 0) return null;
  const groupOf = new Map<string, TabGroup>();
  for (const g of groups) for (const r of g.repos) groupOf.set(r, g);
  // Loose tabs are told apart among all open tabs; inside a group the chip
  // already names the folder, so only same-named tabs of that group differ.
  const names = distinctNames(repos);
  const groupNames = distinctNames(groups.map((g) => g.folder));

  const tab = (r: string, label: string, color?: string) => {
    const distro = wslDistro(r);
    return (
      <div
        key={r}
        role="tab"
        tabIndex={0}
        aria-selected={r === active}
        className={"tab" + (r === active ? " on" : "") + (color ? " grouped" : "")}
        style={color ? ({ "--group-color": color } as React.CSSProperties) : undefined}
        title={r}
        onClick={() => onSelect(r)}
        onKeyDown={(e) => e.key === "Enter" && onSelect(r)}
        onAuxClick={(e) => e.button === 1 && onClose(r)}
      >
        {r === active && <FxBar at="tab" />}
        <span className="tab-name">{label}</span>
        {distro && <span className="tab-tag" title={t("tabs.insideWsl", { distro })}>WSL</span>}
        <button
          className="icon-btn tab-close"
          title={t("tabs.close")}
          onClick={(e) => {
            e.stopPropagation();
            onClose(r);
          }}
        >
          <X size={12} />
        </button>
      </div>
    );
  };

  const items: React.ReactNode[] = [];
  const shown = new Set<string>();
  for (const r of repos) {
    const g = groupOf.get(r);
    if (!g) {
      items.push(tab(r, names.get(r) ?? repoName(r)));
      continue;
    }
    if (shown.has(g.folder)) continue;
    shown.add(g.folder);
    const color = `var(--lane-${groups.indexOf(g) % LANES})`;
    const members = repos.filter((x) => groupOf.get(x) === g);
    const inGroup = distinctNames(members);
    const label = groupNames.get(g.folder) ?? repoName(g.folder);
    items.push(
      <div
        key={`group:${g.folder}`}
        className={"tab-group" + (g.collapsed ? " collapsed" : "")}
        style={{ "--group-color": color } as React.CSSProperties}
        role="button"
        tabIndex={0}
        aria-expanded={!g.collapsed}
        title={`${g.folder}\n${g.collapsed ? t("tabs.expandGroup") : t("tabs.collapseGroup")}`}
        onClick={() => onToggleGroup(g.folder)}
        onKeyDown={(e) => e.key === "Enter" && onToggleGroup(g.folder)}
        onAuxClick={(e) => e.button === 1 && onCloseGroup(g.folder)}
      >
        {g.collapsed ? <ChevronRight size={12} /> : <Layers size={12} />}
        <span className="tab-group-name">{label}</span>
        {g.collapsed && <span className="tab-group-count">{members.length}</span>}
        <button
          className="icon-btn tab-close"
          title={t("tabs.closeGroup")}
          onClick={(e) => {
            e.stopPropagation();
            onCloseGroup(g.folder);
          }}
        >
          <X size={12} />
        </button>
      </div>,
    );
    // A collapsed group still shows its active tab, so you see where you are.
    for (const m of members) if (!g.collapsed || m === active) items.push(tab(m, inGroup.get(m) ?? repoName(m), color));
  }

  return (
    <div className="tabbar" role="tablist" aria-label={t("tabs.label")}>
      {items}
    </div>
  );
}
