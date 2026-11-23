// One file's diff: loads both versions from the agent (`git.file_versions`)
// and shows them in the diff viewer with the shared toolbar. Used for
// unstaged, staged and untracked changes and for a commit's files.
import { Check, ChevronDown, ChevronUp, SlidersHorizontal, X } from "lucide-react";
import { ExpandButton, type Expand } from "./ExpandButton";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DiffSource } from "../../bindings/DiffSource";
import type { FileVersions } from "../../bindings/FileVersions";
import { formatBytes } from "../../lib/format";
import { useSettings } from "../../settings/SettingsProvider";
import { git } from "./api";
import { useDismiss } from "../../lib/useDismiss";
import { DiffViewer, type DiffNav } from "./DiffViewer";

type Props = {
  repo: string;
  source: DiffSource;
  path: string;
  origPath?: string | null;
  /** Changes (e.g. a new snapshot) reload the versions: the file may have
   *  been edited while it's open. */
  reloadKey?: unknown;
  onClose?: () => void;
  /** Expand to the whole tab (only the outermost panel gets it). */
  expand?: Expand;
};

type Loaded = { key: string; versions: FileVersions } | { key: string; error: string };

const keyOf = (s: DiffSource, path: string, orig?: string | null) => JSON.stringify([s, path, orig ?? null]);

export function FileDiffPanel({ repo, source, path, origPath, reloadKey, onClose, expand }: Props) {
  const { t } = useTranslation();
  const { diff: options } = useSettings();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const nav = useRef<DiffNav>(null);
  const key = keyOf(source, path, origPath);

  useEffect(() => {
    let stale = false;
    git
      .fileVersions(repo, { source, path, orig_path: origPath ?? undefined })
      .then((versions) => !stale && setLoaded({ key, versions }))
      .catch((e) => !stale && setLoaded({ key, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, key, reloadKey]);

  const current = loaded?.key === key ? loaded : null;
  const sourceLabel =
    source.kind === "commit"
      ? source.rev.slice(0, 8)
      : source.kind === "staged"
        ? t("git.diff.staged")
        : source.kind === "head"
          ? t("git.diff.headToWorkingTree")
          : t("git.diff.workingTree");

  return (
    <section className="diff panel">
      <header className="diff-head">
        <span className="mono path" title={origPath ? `${origPath} → ${path}` : path}>
          {origPath ? `${origPath} → ${path}` : path}
        </span>
        <span className="chip">{sourceLabel}</span>
        <span className="spacer" />
        {expand && <ExpandButton expand={expand} />}
        {onClose && (
          <button className="icon-btn" onClick={onClose} title={t("git.diff.close")}>
            <X size={14} />
          </button>
        )}
      </header>
      <DiffToolbar onNext={() => nav.current?.next()} onPrevious={() => nav.current?.previous()} />
      <DiffBody current={current} path={path} options={options} nav={nav} />
    </section>
  );
}

function DiffBody({ current, path, options, nav }: { current: Loaded | null; path: string; options: ReturnType<typeof useSettings>["diff"]; nav: React.RefObject<DiffNav | null> }) {
  const { t } = useTranslation();
  if (!current) return <div className="empty-line">{t("common.loading")}</div>;
  if ("error" in current) return <div className="empty danger">{current.error}</div>;
  const { old, new: next } = current.versions;
  if (old?.binary || next?.binary) {
    return <div className="empty">{t("git.diff.binary", { old: old ? formatBytes(old.size) : "—", new: next ? formatBytes(next.size) : "—" })}</div>;
  }
  if (old?.link_target != null || next?.link_target != null) {
    return <div className="empty">{t("git.diff.symlink", { old: old?.link_target ?? old?.text ?? "—", new: next?.link_target ?? next?.text ?? "—" })}</div>;
  }
  let a = old?.text ?? "";
  let b = next?.text ?? "";
  // Windows checkouts (core.autocrlf) have CRLF on disk and LF in git, so an
  // unstaged file would look changed on every line. When one side is all LF
  // and the other all CRLF (exactly that conversion), compare the lines only.
  // Mixed line endings are compared as they are, so real changes show.
  const eolSwap = (pureLf(a) && pureCrlf(b)) || (pureCrlf(a) && pureLf(b));
  if (eolSwap) {
    a = a.replace(/\r\n/g, "\n");
    b = b.replace(/\r\n/g, "\n");
  }
  const same = a === b;
  return (
    <>
      {(old?.truncated || next?.truncated) && <div className="banner warn">{t("git.diff.truncated")}</div>}
      {same ? (
        <div className="empty-line">{eolSwap ? t("git.diff.onlyLineEndings") : t("git.diff.noTextChanges")}</div>
      ) : (
        <DiffViewer ref={nav} path={path} oldText={a} newText={b} options={options} />
      )}
    </>
  );
}

/** Has line breaks, all of them `\n` / all of them `\r\n`. */
const pureLf = (s: string) => s.includes("\n") && !s.includes("\r\n");
const pureCrlf = (s: string) => s.includes("\r\n") && !/(^|[^\r])\n/.test(s);

type Toggle = "word_highlight" | "ignore_whitespace" | "syntax_highlight" | "wrap_lines";

/** Layout, context and display options, saved in the settings. The layout
 *  and context stay visible; the on/off options live in a small menu (like
 *  GitHub's diff settings) so everything fits in one row. */
function DiffToolbar({ onNext, onPrevious }: { onNext: () => void; onPrevious: () => void }) {
  const { t } = useTranslation();
  const { diff: o, updateDiff } = useSettings();
  const [menu, setMenu] = useState(false);
  const options = useDismiss<HTMLDivElement>(menu, () => setMenu(false));
  const toggles: [Toggle, string, string][] = [
    ["word_highlight", t("git.diff.words"), t("git.diff.wordsTitle")],
    ["ignore_whitespace", t("git.diff.whitespace"), t("git.diff.whitespaceTitle")],
    ["syntax_highlight", t("git.diff.syntax"), t("git.diff.syntaxTitle")],
    ["wrap_lines", t("git.diff.wrap"), t("git.diff.wrapTitle")],
  ];
  const active = toggles.filter(([k]) => k !== "syntax_highlight" && k !== "word_highlight" && o[k]).length;
  return (
    <div className="diff-toolbar">
      <div className="segmented" role="radiogroup" aria-label={t("git.diff.layout")}>
        {(["unified", "split", "file"] as const).map((l) => (
          <button key={l} role="radio" aria-checked={o.layout === l} className={o.layout === l ? "on" : ""} onClick={() => updateDiff({ layout: l })}>
            {t(`git.diff.layouts.${l}`)}
          </button>
        ))}
      </div>
      {o.layout !== "file" && (
        <select
          className="context-select"
          value={o.context_lines}
          title={t("git.diff.contextTitle")}
          aria-label={t("git.diff.contextTitle")}
          onChange={(e) => updateDiff({ context_lines: Number(e.target.value) })}
        >
          {[...new Set([3, 10, 25, o.context_lines])].sort((x, y) => x - y).map((n) => (
            <option key={n} value={n}>
              {t("git.diff.contextLines", { count: n })}
            </option>
          ))}
        </select>
      )}
      <div className="diff-options" ref={options}>
        <button className={"icon-btn" + (menu ? " on" : "")} aria-expanded={menu} title={t("git.diff.options")} onClick={() => setMenu(!menu)}>
          <SlidersHorizontal size={14} />
          {active > 0 && <span className="badge-dot" />}
        </button>
        {menu && (
          <div className="menu" role="menu">
            {toggles.map(([key, label, title]) => (
              <button key={key} role="menuitemcheckbox" aria-checked={o[key]} title={title} onClick={() => updateDiff({ [key]: !o[key] })}>
                <span className="menu-check">{o[key] && <Check size={13} />}</span>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="spacer" />
      <button className="icon-btn" onClick={onPrevious} title={t("git.diff.previous")}>
        <ChevronUp size={14} />
      </button>
      <button className="icon-btn" onClick={onNext} title={t("git.diff.next")}>
        <ChevronDown size={14} />
      </button>
    </div>
  );
}
