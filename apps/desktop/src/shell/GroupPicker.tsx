// A folder with many repositories: choose which ones to open (all are
// ticked). Folders with a few open straight away, without asking.
import { Layers } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { distinctNames } from "../lib/names";

/** More repositories than this, and the app asks which to open. */
export const PICK_FROM = 8;

type Props = { folder: string; repos: string[]; onCancel: () => void; onOpen: (repos: string[]) => void };

export function GroupPicker({ folder, repos, onCancel, onOpen }: Props) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState(() => new Set(repos));
  const names = distinctNames(repos);
  const toggle = (r: string) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(r)) n.delete(r);
      else n.add(r);
      return n;
    });

  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        role="dialog"
        aria-labelledby="group-pick-title"
        onSubmit={(e) => {
          e.preventDefault();
          onOpen(repos.filter((r) => chosen.has(r)));
        }}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      >
        <header>
          <Layers size={18} />
          <h2 id="group-pick-title">{t("open.pickTitle", { count: repos.length })}</h2>
        </header>
        <p className="hint mono">{folder}</p>
        <div className="pick-actions">
          <button type="button" className="link-btn" onClick={() => setChosen(new Set(repos))}>
            {t("open.pickAll")}
          </button>
          <button type="button" className="link-btn" onClick={() => setChosen(new Set())}>
            {t("open.pickNone")}
          </button>
        </div>
        <ul className="pick-list">
          {repos.map((r) => (
            <li key={r}>
              <label className="toggle-row" title={r}>
                <input type="checkbox" checked={chosen.has(r)} onChange={() => toggle(r)} />
                <span>{names.get(r)}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="primary" disabled={chosen.size === 0} autoFocus>
            {t("open.pickOpen", { count: chosen.size })}
          </button>
        </div>
      </form>
    </div>
  );
}
