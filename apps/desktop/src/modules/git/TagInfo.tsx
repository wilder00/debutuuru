// A tag's details above its commit's changes: kind (annotated or
// lightweight), signature, who tagged it and when, its message, and what to
// do with it (check it out, push it, delete it here or on the remote).
import { CloudOff, Copy, GitCommitHorizontal, ShieldCheck, Tag as TagIcon, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Tag } from "../../bindings/Tag";
import { fullDate, relativeTime } from "../../lib/format";

export type TagActions = {
  tag: Tag;
  hasRemote: boolean;
  onCheckout: () => void;
  onPush: (deleteOnRemote: boolean) => void;
  onDelete: () => void;
};

export function TagInfo({ tag, hasRemote, onCheckout, onPush, onDelete }: TagActions) {
  const { t } = useTranslation();
  // Deleting asks twice: the first click arms the button.
  const [armed, setArmed] = useState<"local" | "remote" | null>(null);
  useEffect(() => setArmed(null), [tag.name]);
  const noRemote = hasRemote ? undefined : t("git.remote.noRemote");

  return (
    <div className="tag-info">
      <div className="tag-title">
        <TagIcon size={14} className="tag-icon" />
        <span className="tag-name mono">{tag.name}</span>
        <span className="tag-badge">{tag.annotated ? t("git.tags.annotated") : t("git.tags.lightweight")}</span>
        {tag.signed && (
          <span className="tag-badge signed" title={t("git.tags.signedHint")}>
            <ShieldCheck size={11} /> {t("git.tags.signed")}
          </span>
        )}
        <button className="link-btn" title={t("git.tags.copyName")} onClick={() => void navigator.clipboard.writeText(tag.name)}>
          <Copy size={11} />
        </button>
      </div>
      <div className="commit-meta hint">
        {tag.tagger && <span title={tag.email ?? undefined}>{t("git.tags.taggedBy", { name: tag.tagger })}</span>}
        <span title={fullDate(tag.time)}>{relativeTime(tag.time)}</span>
        <span className="mono">
          <GitCommitHorizontal size={11} /> {tag.target.slice(0, 8)}
        </span>
      </div>
      {tag.message && <pre className="commit-body">{tag.message}</pre>}
      <div className="tag-actions">
        <button onClick={onCheckout} title={t("git.tags.checkoutHint")}>
          {t("git.tags.checkout")}
        </button>
        <button onClick={() => onPush(false)} disabled={!hasRemote} title={noRemote ?? t("git.tags.pushHint")}>
          <Upload size={13} /> {t("git.tags.push")}
        </button>
        <button
          className={armed === "remote" ? "danger" : ""}
          disabled={!hasRemote}
          title={noRemote ?? t("git.tags.deleteRemoteHint")}
          onClick={() => (armed === "remote" ? (setArmed(null), onPush(true)) : setArmed("remote"))}
        >
          <CloudOff size={13} /> {armed === "remote" ? t("git.tags.confirm") : t("git.tags.deleteRemote")}
        </button>
        <button
          className={armed === "local" ? "danger" : ""}
          title={t("git.tags.deleteHint")}
          onClick={() => (armed === "local" ? (setArmed(null), onDelete()) : setArmed("local"))}
        >
          <Trash2 size={13} /> {armed === "local" ? t("git.tags.confirm") : t("git.tags.delete")}
        </button>
      </div>
    </div>
  );
}
