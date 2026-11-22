// A commit's changes: its message and author, the files it changed (against
// its first parent, like GitHub) with lines added/removed, and the diff of
// the selected file.
import { Copy, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChangedFile } from "../../bindings/ChangedFile";
import type { CommitDetails } from "../../bindings/CommitDetails";
import { fullDate, relativeTime, splitPath } from "../../lib/format";
import { git } from "./api";
import { ExpandButton, type Expand } from "./ExpandButton";
import { FileDiffPanel } from "./FileDiffPanel";
import { statusName } from "./status";

type Props = { repo: string; hash: string; onClose: () => void; expand?: Expand };

export function CommitPanel({ repo, hash, onClose, expand }: Props) {
  const { t } = useTranslation();
  const [details, setDetails] = useState<CommitDetails | { error: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    setDetails(null);
    git
      .commitDetails(repo, { rev: hash })
      .then((d) => {
        if (stale) return;
        setDetails(d);
        setSelected(d.files[0]?.path ?? null);
      })
      .catch((e) => !stale && setDetails({ error: e instanceof Error ? e.message : String(e) }));
    return () => {
      stale = true;
    };
  }, [repo, hash]);

  if (!details) return <section className="commit-panel panel"><div className="empty-line">{t("common.loading")}</div></section>;
  if ("error" in details) return <section className="commit-panel panel"><div className="empty danger">{details.error}</div></section>;

  const file = details.files.find((f) => f.path === selected) ?? null;
  const added = details.files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const removed = details.files.reduce((n, f) => n + (f.deletions ?? 0), 0);

  return (
    <section className="commit-panel panel">
      <header className="commit-info">
        <div className="commit-title">
          <span className="subject">{details.subject}</span>
          <span className="spacer" />
          {expand && <ExpandButton expand={expand} />}
          <button className="icon-btn" onClick={onClose} title={t("common.dismiss")}>
            <X size={14} />
          </button>
        </div>
        <div className="commit-meta hint">
          <span title={details.email}>{details.author}</span>
          <span title={fullDate(details.time)}>{relativeTime(details.time)}</span>
          <button className="link-btn mono" title={t("git.commitPanel.copyHash")} onClick={() => void navigator.clipboard.writeText(details.hash)}>
            <Copy size={11} /> {details.hash.slice(0, 8)}
          </button>
          {details.parents.length > 1 && <span>{t("git.commitPanel.merge", { parent: details.parents[0].slice(0, 8) })}</span>}
          <span>
            {t("git.commitPanel.files", { count: details.files.length })} · <span className="ok mono">+{added}</span>{" "}
            <span className="danger mono">−{removed}</span>
          </span>
        </div>
        {details.body && <pre className="commit-body">{details.body}</pre>}
      </header>
      <div className="commit-content">
        <ul className="commit-files">
          {details.files.length === 0 && <li className="empty-line">{t("git.commitPanel.noFiles")}</li>}
          {details.files.map((f) => (
            <FileRow key={f.path} file={f} selected={f.path === selected} onSelect={() => setSelected(f.path)} />
          ))}
        </ul>
        {file ? (
          <FileDiffPanel repo={repo} source={{ kind: "commit", rev: details.hash }} path={file.path} origPath={file.orig_path} />
        ) : (
          <div className="empty">{t("git.filesView.selectFile")}</div>
        )}
      </div>
    </section>
  );
}

function FileRow({ file: f, selected, onSelect }: { file: ChangedFile; selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation();
  const [dir, name] = splitPath(f.path);
  // Same letters and colors as the Changes panel.
  const letter = f.status === "T" ? "M" : f.status;
  return (
    <li className={"item file" + (selected ? " selected" : "")} onClick={onSelect} title={f.orig_path ? `${f.orig_path} → ${f.path}` : f.path}>
      <span className={`status s-${letter}`} title={statusName(t, letter)}>
        {letter}
      </span>
      <span className="label">
        {name}
        {dir && <span className="dir">{dir}</span>}
      </span>
      {f.additions === null ? (
        <span className="hint">{t("git.commitPanel.binary")}</span>
      ) : (
        <span className="file-stat mono">
          <span className="ok">+{f.additions}</span> <span className="danger">−{f.deletions}</span>
        </span>
      )}
    </li>
  );
}
