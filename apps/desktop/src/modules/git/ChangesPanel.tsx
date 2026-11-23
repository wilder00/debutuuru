import { ChevronRight, FolderTree, List, Minus, Plus, TextAlignStart } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ChangesView } from "../../bindings/ChangesView";
import type { FileChange } from "../../bindings/FileChange";
import type { Status } from "../../bindings/Status";
import { splitPath } from "../../lib/format";
import { useSettings } from "../../settings/SettingsProvider";
import { git } from "./api";
import { FileIcon } from "./fileIcons";
import { statusName } from "./status";

export type FileSelection = { file: FileChange; staged: boolean };

type Props = {
  repo: string;
  status: Status;
  selected: FileSelection | null;
  onSelect: (s: FileSelection) => void;
  /** Runs an action, shows its error if any, then reloads the repo. */
  act: (fn: () => Promise<unknown>) => Promise<boolean>;
};

/** A folder of the tree view; chains of single folders are merged (`src/lib`). */
type Dir = { name: string; path: string; dirs: Dir[]; files: FileChange[] };

function buildTree(files: FileChange[]): Dir {
  const root: Dir = { name: "", path: "", dirs: [], files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let d = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let next = d.dirs.find((x) => x.path === path);
      if (!next) d.dirs.push((next = { name: parts[i], path, dirs: [], files: [] }));
      d = next;
    }
    d.files.push(f);
  }
  const compact = (d: Dir): Dir => {
    while (d.path && d.files.length === 0 && d.dirs.length === 1) {
      const only = d.dirs[0];
      d = { ...only, name: d.name + "/" + only.name };
    }
    return {
      ...d,
      dirs: d.dirs.map(compact).sort((a, b) => a.name.localeCompare(b.name)),
      files: [...d.files].sort((a, b) => a.path.localeCompare(b.path)),
    };
  };
  return compact(root);
}

const filesUnder = (d: Dir): string[] => [...d.files.map((f) => f.path), ...d.dirs.flatMap(filesUnder)];

const VIEWS: { view: ChangesView; icon: ReactNode }[] = [
  { view: "list", icon: <List size={13} /> },
  { view: "path", icon: <TextAlignStart size={13} /> },
  { view: "tree", icon: <FolderTree size={13} /> },
];

export function ChangesPanel({ repo, status, selected, onSelect, act }: Props) {
  const { t } = useTranslation();
  const { layout, updateLayout } = useSettings();
  const view: ChangesView = layout.changes_view ?? "list";
  const [message, setMessage] = useState("");
  /** Closed folders of the tree view, `s:`/`u:` + path (open by default). */
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const { staged, unstaged } = useMemo(
    () => ({
      staged: status.files.filter((f) => f.index !== " " && f.index !== "?"),
      unstaged: status.files.filter((f) => f.worktree !== " "),
    }),
    [status],
  );
  const trees = useMemo(() => (view === "tree" ? { staged: buildTree(staged), unstaged: buildTree(unstaged) } : null), [view, staged, unstaged]);

  const stageButton = (isStaged: boolean, paths: string[], title: string) => (
    <button
      className="icon-btn hover-only"
      title={title}
      onClick={(ev) => {
        ev.stopPropagation();
        act(() => (isStaged ? git.unstage : git.stage)(repo, { paths }));
      }}
    >
      {isStaged ? <Minus size={14} /> : <Plus size={14} />}
    </button>
  );

  /** One file; `depth` is set in the tree view. */
  const row = (f: FileChange, isStaged: boolean, depth?: number) => {
    const letter = isStaged ? f.index : f.worktree;
    const [dir, name] = splitPath(f.path);
    const isSel = selected?.file.path === f.path && selected.staged === isStaged;
    const tree = depth !== undefined;
    const badge = (
      <span className={`status s-${letter === "?" ? "q" : letter}`} title={statusName(t, letter)}>
        {letter === "?" ? "U" : letter}
      </span>
    );
    return (
      <li
        key={(isStaged ? "s:" : "u:") + f.path}
        className={"item file" + (isSel ? " selected" : "")}
        style={tree ? { paddingLeft: 8 + depth * 14 } : undefined}
        onClick={() => onSelect({ file: f, staged: isStaged })}
      >
        {tree ? (
          <>
            <span className="chev" />
            <FileIcon name={name} />
          </>
        ) : (
          badge
        )}
        <span className="label" title={f.orig_path ? `${f.orig_path} → ${f.path}` : f.path}>
          {view === "path" && <span className="path-dir">{dir}</span>}
          {name}
          {view === "list" && dir && <span className="dir">{dir}</span>}
        </span>
        {tree && badge}
        {stageButton(isStaged, [f.path], isStaged ? t("git.changes.unstage") : t("git.changes.stage"))}
      </li>
    );
  };

  const treeRows = (d: Dir, isStaged: boolean, depth: number): ReactNode[] => [
    ...d.dirs.flatMap((sub) => {
      const key = (isStaged ? "s:" : "u:") + sub.path;
      const open = !closed.has(key);
      const toggle = () =>
        setClosed((c) => {
          const next = new Set(c);
          if (open) next.add(key);
          else next.delete(key);
          return next;
        });
      return [
        <li key={key + "/"} className="item file folder" style={{ paddingLeft: 8 + depth * 14 }} onClick={toggle} title={sub.path} aria-expanded={open}>
          <span className={"chev" + (open ? " open" : "")}>
            <ChevronRight size={12} />
          </span>
          <FileIcon name={sub.name.split("/").pop() ?? sub.name} folder open={open} />
          <span className="label">{sub.name}</span>
          {stageButton(isStaged, filesUnder(sub), isStaged ? t("git.changes.unstageFolder") : t("git.changes.stageFolder"))}
        </li>,
        ...(open ? treeRows(sub, isStaged, depth + 1) : []),
      ];
    }),
    ...d.files.map((f) => row(f, isStaged, depth)),
  ];

  const items = (files: FileChange[], isStaged: boolean): ReactNode[] => {
    if (trees) return treeRows(isStaged ? trees.staged : trees.unstaged, isStaged, 0);
    const sorted = view === "path" ? [...files].sort((a, b) => a.path.localeCompare(b.path)) : files;
    return sorted.map((f) => row(f, isStaged));
  };

  async function commit() {
    if (await act(() => git.commit(repo, { message }))) setMessage("");
  }

  return (
    <section className="changes panel">
      <div className="changes-bar">
        <span className="spacer" />
        <div className="segmented" role="radiogroup" aria-label={t("git.changes.view.label")}>
          {VIEWS.map((v) => (
            <button
              key={v.view}
              role="radio"
              aria-checked={view === v.view}
              className={view === v.view ? "on" : ""}
              title={t(`git.changes.view.${v.view}`)}
              onClick={() => updateLayout({ changes_view: v.view })}
            >
              {v.icon}
            </button>
          ))}
        </div>
      </div>
      <div className={"changes-lists view-" + view}>
        <Header title={t("git.changes.staged")} count={staged.length} action={staged.length > 0 ? t("git.changes.unstageAll") : null} onAction={() => act(() => git.unstage(repo, { paths: staged.map((f) => f.path) }))} />
        <ul>{staged.length ? items(staged, true) : <li className="empty-line">{t("git.changes.nothingStaged")}</li>}</ul>
        <Header title={t("git.changes.changes")} count={unstaged.length} action={unstaged.length > 0 ? t("git.changes.stageAll") : null} onAction={() => act(() => git.stage(repo, { paths: unstaged.map((f) => f.path) }))} />
        <ul>{unstaged.length ? items(unstaged, false) : <li className="empty-line">{t("git.changes.clean")}</li>}</ul>
      </div>
      <div className="commit-box">
        <textarea
          placeholder={t("git.changes.messagePlaceholder")}
          value={message}
          spellCheck
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.ctrlKey && commit()}
        />
        <button className="primary" disabled={!message.trim() || staged.length === 0} onClick={commit} title="Ctrl+Enter">
          {staged.length > 0 ? t("git.changes.commitFiles", { count: staged.length }) : t("git.changes.commit")}
        </button>
      </div>
    </section>
  );
}

function Header({ title, count, action, onAction }: { title: string; count: number; action: string | null; onAction: () => void }) {
  return (
    <div className="list-head">
      <span>{title}</span>
      <span className="count">{count}</span>
      <span className="spacer" />
      {action && (
        <button className="link-btn" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}
