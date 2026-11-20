import { X } from "lucide-react";
import { useMemo } from "react";

type Line = { kind: "add" | "del" | "ctx" | "hunk" | "meta"; text: string; old?: number; new?: number };

/** Parses a unified diff into lines with old/new line numbers. */
function parse(diff: string): Line[] {
  const out: Line[] = [];
  let o = 0;
  let n = 0;
  let inHunk = false;
  for (const text of diff.split("\n")) {
    const m = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) {
      o = Number(m[1]);
      n = Number(m[2]);
      inHunk = true;
      out.push({ kind: "hunk", text });
    } else if (!inHunk) {
      if (text) out.push({ kind: "meta", text });
    } else if (text.startsWith("+")) out.push({ kind: "add", text: text.slice(1), new: n++ });
    else if (text.startsWith("-")) out.push({ kind: "del", text: text.slice(1), old: o++ });
    else if (text.startsWith("\\")) out.push({ kind: "meta", text });
    else if (text !== "" || o || n) out.push({ kind: "ctx", text: text.slice(1), old: o++, new: n++ });
  }
  while (out.length && out[out.length - 1].kind === "ctx" && out[out.length - 1].text === "") out.pop();
  return out;
}

export function DiffView({ path, staged, diff, onClose }: { path: string; staged: boolean; diff: string | null; onClose: () => void }) {
  const lines = useMemo(() => (diff ? parse(diff) : []), [diff]);
  const adds = lines.filter((l) => l.kind === "add").length;
  const dels = lines.filter((l) => l.kind === "del").length;
  return (
    <section className="diff panel">
      <header className="diff-head">
        <span className="mono path">{path}</span>
        <span className="chip">{staged ? "staged" : "working tree"}</span>
        <span className="mono ok">+{adds}</span>
        <span className="mono danger">−{dels}</span>
        <span className="spacer" />
        <button className="icon-btn" onClick={onClose} title="Close diff">
          <X size={14} />
        </button>
      </header>
      <div className="diff-body mono">
        {diff === null ? (
          <div className="empty-line">Loading…</div>
        ) : lines.length === 0 ? (
          <div className="empty-line">No textual changes (binary file or mode change)</div>
        ) : (
          lines
            .filter((l) => l.kind !== "meta")
            .map((l, i) => (
              <div key={i} className={`dl dl-${l.kind}`}>
                <span className="ln">{l.old ?? ""}</span>
                <span className="ln">{l.new ?? ""}</span>
                <span className="sign">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : ""}</span>
                <span className="code">{l.text || " "}</span>
              </div>
            ))
        )}
      </div>
    </section>
  );
}
