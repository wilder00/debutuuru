// Create a tag on a commit: a name, annotated (with a message) or
// lightweight, and optionally push it right away.
import { Tag as TagIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  /** Commit to tag and how to show it ("a1b2c3d4 · fix: …"). */
  target: { rev: string; label: string };
  existing: string[];
  hasRemote: boolean;
  onCancel: () => void;
  onCreate: (p: { name: string; message: string | null; push: boolean }) => void;
};

/** Mirrors the agent's check plus git's main ref-name rules. */
const badName = (n: string) => !n || n.startsWith("-") || n.endsWith(".") || n.endsWith("/") || n.endsWith(".lock") || /[\s~^:?*[\\\x00-\x1f\x7f]|\.\.|@\{|\/\//.test(n);

export function TagDialog({ target, existing, hasRemote, onCancel, onCreate }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [annotated, setAnnotated] = useState(true);
  const [message, setMessage] = useState("");
  const [push, setPush] = useState(false);
  const trimmed = name.trim();
  const problem = !trimmed ? null : existing.includes(trimmed) ? t("git.tags.exists") : badName(trimmed) ? t("git.tags.invalid") : null;
  const ok = !!trimmed && !problem && (!annotated || message.trim() !== "");

  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        role="dialog"
        aria-labelledby="tag-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onCreate({ name: trimmed, message: annotated ? message : null, push: push && hasRemote });
        }}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      >
        <header>
          <TagIcon size={18} />
          <h2 id="tag-title">{t("git.tags.createTitle")}</h2>
        </header>
        <p className="hint mono">{target.label}</p>
        <label className="block-field">
          {t("git.tags.name")}
          <input className="mono" autoFocus value={name} placeholder="v1.2.0" spellCheck={false} onChange={(e) => setName(e.target.value)} aria-invalid={!!problem} />
          {problem && <span className="danger hint">{problem}</span>}
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={annotated} onChange={(e) => setAnnotated(e.target.checked)} />
          <span>
            {t("git.tags.annotatedOption")}
            <span className="hint block">{t("git.tags.annotatedHint")}</span>
          </span>
        </label>
        {annotated && (
          <label className="block-field">
            {t("git.tags.message")}
            <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("git.tags.messagePlaceholder")} />
          </label>
        )}
        {hasRemote && (
          <label className="toggle-row">
            <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} />
            <span>{t("git.tags.pushAfter")}</span>
          </label>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="primary" disabled={!ok}>
            {t("git.tags.createButton")}
          </button>
        </div>
      </form>
    </div>
  );
}
