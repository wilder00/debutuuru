import { ArrowDown, ChevronDown, ChevronRight, Cloud, CloudDownload, Copy, FolderGit2, GitBranch, LogIn, Plus, Tag, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Snapshot } from "../../bindings/Snapshot";
import { fullDate, relativeTime } from "../../lib/format";
import { distinctNames } from "../../lib/names";
import { useDismiss } from "../../lib/useDismiss";

type Props = {
  snapshot: Snapshot;
  onCheckout: (branch: string) => void;
  onOpenWorktree: (path: string) => void;
  /** Tag shown in the details panel. */
  selectedTag: string | null;
  onSelectTag: (name: string) => void;
  onCreateTag: () => void;
  /** Local `x` and remote `origin/x` names, to confirm and delete. */
  onDeleteBranches: (names: string[]) => void;
  /** Bring a branch up to date from its remote without checking it out
   *  (local `x` from its upstream, or remote `origin/x`). */
  onUpdateBranch: (name: string) => void;
  /** Pull the checked-out branch. */
  onPull: () => void;
};

/** With more tags than this, the section gets a filter box. */
const FILTER_FROM = 8;

export function Sidebar({ snapshot, onCheckout, onOpenWorktree, selectedTag, onSelectTag, onCreateTag, onDeleteBranches, onUpdateBranch, onPull }: Props) {
  const { t } = useTranslation();
  const local = snapshot.branches.filter((b) => !b.is_remote);
  const remote = snapshot.branches.filter((b) => b.is_remote);
  const root = snapshot.info.root;
  // Worktrees of one project often share the folder name (one per ticket).
  const wtNames = distinctNames(snapshot.worktrees.map((w) => w.path));
  const [tagFilter, setTagFilter] = useState("");
  const tags = snapshot.tags.filter((g) => g.name.toLowerCase().includes(tagFilter.trim().toLowerCase()));

  // Branch selection, like a file list: click one, Ctrl+click adds or
  // removes, Shift+click takes the range (local branches, then remote ones).
  const order = [...local.map((b) => b.name), ...remote.map((b) => b.name)];
  const [sel, setSel] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useDismiss<HTMLDivElement>(menu !== null, () => setMenu(null));
  // Branches that are gone (deleted, pruned) leave the selection.
  const orderKey = order.join("\n");
  useEffect(() => {
    setSel((s) => {
      const kept = [...s].filter((n) => order.includes(n));
      return kept.length === s.size ? s : new Set(kept);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);
  const pick = (name: string, e: React.MouseEvent) => {
    if (e.shiftKey && anchor.current && order.includes(anchor.current)) {
      const [a, b] = [order.indexOf(anchor.current), order.indexOf(name)].sort((x, y) => x - y);
      const range = order.slice(a, b + 1);
      setSel((s) => new Set(e.ctrlKey || e.metaKey ? [...s, ...range] : range));
      return;
    }
    anchor.current = name;
    if (e.ctrlKey || e.metaKey) {
      setSel((s) => {
        const n = new Set(s);
        if (n.has(name)) n.delete(name);
        else n.add(name);
        return n;
      });
    } else setSel(new Set([name]));
  };
  const openMenu = (name: string, e: React.MouseEvent) => {
    e.preventDefault();
    if (!sel.has(name)) {
      anchor.current = name;
      setSel(new Set([name]));
    }
    setMenu({ x: e.clientX, y: e.clientY });
  };
  const selected = order.filter((n) => sel.has(n));
  const single = selected.length === 1 ? local.find((b) => b.name === selected[0]) : undefined;
  const singleRemote = selected.length === 1 ? remote.find((b) => b.name === selected[0]) : undefined;
  const branchProps = (name: string) => ({
    onClick: (e: React.MouseEvent) => pick(name, e),
    onContextMenu: (e: React.MouseEvent) => openMenu(name, e),
    "aria-selected": sel.has(name),
  });

  return (
    <aside
      className="sidebar panel"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape" && sel.size && !menu) setSel(new Set());
        if (e.key === "Delete" && selected.length) onDeleteBranches(selected);
      }}
    >
      <Group title={t("git.sidebar.branches")} count={local.length} icon={<GitBranch size={13} />}>
        {local.map((b) => (
          <li
            key={b.name}
            className={"item" + (b.is_head ? " current" : "") + (sel.has(b.name) ? " selected" : "")}
            title={`${b.subject}\n${t("git.sidebar.checkoutHint")}\n${t("git.sidebar.selectHint")}`}
            onDoubleClick={() => !b.is_head && onCheckout(b.name)}
            {...branchProps(b.name)}
          >
            <span className="dot" aria-hidden />
            <span className="label">{b.name}</span>
            {b.upstream && <span className="aside">{b.upstream}</span>}
          </li>
        ))}
      </Group>
      <Group title={t("git.sidebar.remotes")} count={snapshot.remotes.length} icon={<Cloud size={13} />}>
        {snapshot.remotes.length === 0 && <li className="empty-line">{t("git.sidebar.noRemotes")}</li>}
        {snapshot.remotes.map((r) => (
          <li key={r.name} className="item" title={`fetch: ${r.fetch_url}\npush:  ${r.push_url}`}>
            <span className="label">{r.name}</span>
            <span className={`transport t-${r.transport}`}>{r.transport}</span>
          </li>
        ))}
        {remote.map((b) => (
          <li key={b.name} className={"item sub" + (sel.has(b.name) ? " selected" : "")} title={`${b.subject}\n${t("git.sidebar.selectHint")}`} {...branchProps(b.name)}>
            <span className="label">{b.name}</span>
          </li>
        ))}
      </Group>
      {menu &&
        createPortal(
        <div className="menu context-menu" role="menu" ref={menuRef} style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 140) }}>
          {single && !single.is_head && (
            <button role="menuitem" onClick={() => (setMenu(null), onCheckout(single.name))}>
              <LogIn size={14} /> {t("git.sidebar.menu.checkout")}
            </button>
          )}
          {single?.is_head && single.upstream && (
            <button role="menuitem" onClick={() => (setMenu(null), onPull())}>
              <ArrowDown size={14} /> {t("git.sidebar.menu.pull", { upstream: single.upstream })}
            </button>
          )}
          {single && !single.is_head && single.upstream && (
            <button role="menuitem" title={t("git.sidebar.menu.updateHint")} onClick={() => (setMenu(null), onUpdateBranch(single.name))}>
              <CloudDownload size={14} /> {t("git.sidebar.menu.update", { upstream: single.upstream })}
            </button>
          )}
          {singleRemote && (
            <button role="menuitem" title={t("git.sidebar.menu.fetchOneHint")} onClick={() => (setMenu(null), onUpdateBranch(singleRemote.name))}>
              <CloudDownload size={14} /> {t("git.sidebar.menu.fetchOne", { branch: singleRemote.name })}
            </button>
          )}
          <button role="menuitem" onClick={() => (setMenu(null), void navigator.clipboard.writeText(selected.join("\n")))}>
            <Copy size={14} /> {t("git.sidebar.menu.copy", { count: selected.length })}
          </button>
          <div className="menu-sep" role="separator" />
          <button role="menuitem" className="danger" onClick={() => (setMenu(null), onDeleteBranches(selected))}>
            <Trash2 size={14} /> {t("git.sidebar.menu.delete", { count: selected.length })}
            <kbd>Del</kbd>
          </button>
        </div>,
        // On <body>: the panel's blur would clip a fixed menu inside it.
        document.body,
      )}
      <Group
        title={t("git.sidebar.tags")}
        count={snapshot.tags.length}
        icon={<Tag size={13} />}
        action={
          <button className="icon-btn group-action" title={t("git.tags.create")} onClick={onCreateTag}>
            <Plus size={13} />
          </button>
        }
      >
        {snapshot.tags.length > FILTER_FROM && (
          <li className="group-filter">
            <input value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} placeholder={t("git.tags.filter")} aria-label={t("git.tags.filter")} spellCheck={false} />
          </li>
        )}
        {snapshot.tags.length === 0 && <li className="empty-line">{t("git.tags.none")}</li>}
        {tags.map((g) => (
          <li
            key={g.name}
            className={"item" + (g.name === selectedTag ? " selected" : "")}
            title={`${g.name} · ${g.annotated ? t("git.tags.annotated") : t("git.tags.lightweight")}\n${fullDate(g.time)}\n${g.commit_subject}`}
            onClick={() => onSelectTag(g.name)}
          >
            <span className="label">{g.name}</span>
            <span className="aside">{relativeTime(g.time)}</span>
          </li>
        ))}
      </Group>
      <Group title={t("git.sidebar.worktrees")} count={snapshot.worktrees.length} icon={<FolderGit2 size={13} />}>
        {snapshot.worktrees.map((w) => {
          const current = w.path === root;
          return (
            <li
              key={w.path}
              className={"item" + (current ? " current" : "")}
              title={`${w.path}${current ? "" : `\n${t("git.sidebar.openHint")}`}`}
              onClick={() => !current && onOpenWorktree(w.path)}
            >
              <span className="label">{wtNames.get(w.path)}</span>
              <span className="aside">{w.branch ?? (w.bare ? t("git.sidebar.bare") : t("common.detached"))}</span>
            </li>
          );
        })}
      </Group>
    </aside>
  );
}

function Group(p: { title: string; count: number; icon: ReactNode; initiallyOpen?: boolean; action?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(p.initiallyOpen ?? true);
  return (
    <section className="group">
      <div className="group-row">
        <button className="group-head" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {p.icon}
          <span>{p.title}</span>
          <span className="count">{p.count}</span>
        </button>
        {p.action}
      </div>
      {open && <ul>{p.children}</ul>}
    </section>
  );
}
