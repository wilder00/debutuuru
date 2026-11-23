// Quick open (Ctrl+P) and command palette (Ctrl+Shift+P), like VS Code: the
// same box searches the repo's files, or commands when the text starts with
// ">" (deleting it goes back to files). Fuzzy matching is fuzzysort
// (Sublime-style); commands can open a second list ("Switch branch…").
import fuzzysort from "fuzzysort";
import { ChevronRight, File, Loader2, TerminalSquare } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { fs } from "../modules/folder/api";
import { git } from "../modules/git/api";

export type PaletteItem = {
  id: string;
  label: string;
  /** Shown muted after the label (group, description). */
  detail?: string;
  /** Shortcut hint, e.g. "Ctrl+,". */
  keys?: string;
  run?: () => void;
  /** Opens a second list instead of running. */
  pick?: () => PaletteItem[] | Promise<PaletteItem[]>;
};

type Props = {
  /** Text to start with: "" for files, ">" for commands. */
  initial: string;
  /** Active repository (files come from it), or null. */
  repo: string | null;
  /** `repo` is a plain folder (a group's Folder tab), not a repository. */
  folder?: boolean;
  commands: PaletteItem[];
  onOpenFile: (path: string) => void;
  onClose: () => void;
};

const LIMIT = 100;

/** Recently opened files per repo (this session), shown first. */
const recents = new Map<string, string[]>();
export function recordOpen(repo: string, path: string) {
  recents.set(repo, [path, ...(recents.get(repo) ?? []).filter((p) => p !== path)].slice(0, 20));
}

type FileEntry = { path: string; name: string; dir: string };
const fileEntry = (path: string): FileEntry => {
  const i = path.lastIndexOf("/");
  return { path, name: path.slice(i + 1), dir: i < 0 ? "" : path.slice(0, i) };
};

export function Palette({ initial, repo, folder = false, commands, onOpenFile, onClose }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(initial);
  const [files, setFiles] = useState<FileEntry[] | { error: string } | null>(null);
  /** Second-level list (from a command's `pick`) and its title. */
  const [sub, setSub] = useState<{ title: string; items: PaletteItem[] } | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const commandMode = !sub && query.startsWith(">");

  useEffect(() => {
    input.current?.focus();
  }, [sub]);

  // The file list is read when the palette opens (fast: one git call).
  useEffect(() => {
    if (!repo) return;
    let stale = false;
    (folder ? fs.listFiles(repo) : git.listFiles(repo, {}))
      .then((paths) => !stale && setFiles(paths.map(fileEntry)))
      .catch((e) => !stale && setFiles({ error: e instanceof Error ? e.message : String(e) }));
    return () => {
      stale = true;
    };
  }, [repo, folder]);

  type Row = { key: string; icon: ReactNode; label: ReactNode; detail?: ReactNode; keys?: string; more?: boolean; run: () => void };

  const rows: Row[] = useMemo(() => {
    const cmdRow = (c: PaletteItem, label: ReactNode = c.label): Row => ({
      key: c.id,
      icon: <TerminalSquare size={14} />,
      label,
      detail: c.detail,
      keys: c.keys,
      more: !!c.pick,
      run: async () => {
        if (c.pick) {
          setSub({ title: c.label, items: await c.pick() });
          setQuery("");
          setActive(0);
        } else {
          onClose();
          c.run?.();
        }
      },
    });
    const searchItems = (items: PaletteItem[], q: string) =>
      q.trim()
        ? fuzzysort.go(q.trim(), items, { key: "label", limit: LIMIT }).map((r) => cmdRow(r.obj, <Marked parts={r.highlight((m, i) => <mark key={i}>{m}</mark>)} />))
        : items.slice(0, LIMIT).map((c) => cmdRow(c));

    if (sub) return searchItems(sub.items, query);
    if (commandMode) return searchItems(commands, query.slice(1));
    if (!Array.isArray(files)) return [];
    const fileRow = (f: FileEntry, name: ReactNode = f.name, dir: ReactNode = f.dir): Row => ({
      key: f.path,
      icon: <File size={14} />,
      label: name,
      detail: dir,
      run: () => {
        onClose();
        if (repo) recordOpen(repo, f.path);
        onOpenFile(f.path);
      },
    });
    const q = query.trim().replace(/\\/g, "/");
    if (!q) {
      const recent = (repo && recents.get(repo)) || [];
      const rest = files.filter((f) => !recent.includes(f.path)).slice(0, LIMIT - recent.length);
      return [...recent.map((p) => fileRow(fileEntry(p))), ...rest.map((f) => fileRow(f))];
    }
    // Name and path both count, like VS Code (typing a folder narrows too).
    return fuzzysort.go(q, files, { keys: ["name", "path"], limit: LIMIT }).map((r) =>
      fileRow(
        r.obj,
        r[0].target ? <Marked parts={r[0].highlight((m, i) => <mark key={i}>{m}</mark>)} /> : r.obj.name,
        r.obj.dir,
      ),
    );
  }, [sub, commandMode, commands, files, query, repo, onClose, onOpenFile]);

  useEffect(() => setActive(0), [query, sub]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = rows.length;
      if (n) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      rows[active]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (sub) {
        setSub(null);
        setQuery(">");
      } else onClose();
    }
  };

  const placeholder = sub ? sub.title : commandMode ? t("palette.commandsPlaceholder") : t("palette.filesPlaceholder");
  const fileMode = !commandMode && !sub;
  const empty: ReactNode =
    fileMode && !repo ? t("palette.noRepo")
    : fileMode && files === null ? <Loader2 size={14} className="spin" />
    : fileMode && files && "error" in files ? files.error
    : t("palette.noResults");

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label={placeholder} onKeyDown={onKey}>
        {sub && <div className="palette-title">{sub.title}</div>}
        <input
          ref={input}
          value={query}
          placeholder={placeholder}
          spellCheck={false}
          role="combobox"
          aria-expanded
          aria-controls="palette-list"
          aria-activedescendant={rows[active] ? `palette-row-${active}` : undefined}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="palette-list" id="palette-list" role="listbox" ref={list}>
          {rows.map((r, i) => (
            <li
              key={r.key}
              id={`palette-row-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === active}
              className={"palette-row" + (i === active ? " on" : "")}
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => r.run()}
            >
              <span className="palette-icon">{r.icon}</span>
              <span className="palette-label">{r.label}</span>
              {r.detail && <span className="palette-detail">{r.detail}</span>}
              {r.keys && <kbd>{r.keys}</kbd>}
              {r.more && <ChevronRight size={13} className="palette-more" />}
            </li>
          ))}
          {!rows.length && (
            <li className="palette-empty">{empty}</li>
          )}
        </ul>
        <div className="palette-hint hint">{commandMode || sub ? t("palette.hintCommands") : t("palette.hintFiles")}</div>
      </div>
    </div>
  );
}

function Marked({ parts }: { parts: ReactNode[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </>
  );
}
