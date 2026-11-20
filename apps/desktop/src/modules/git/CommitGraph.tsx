import { useVirtualizer } from "@tanstack/react-virtual";
import { Tag } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import type { GraphRow } from "../../bindings/GraphRow";
import type { LogEntry } from "../../bindings/LogEntry";
import { fullDate, parseRefs, relativeTime } from "../../lib/format";
import { LANE_COUNT } from "../../theme/generate";

const LANE_W = 16;
const PAD = 8;
const lane = (i: number) => `var(--lane-${i % LANE_COUNT})`;
const x = (i: number) => PAD + i * LANE_W + LANE_W / 2;

function GraphCell({ g, width, height, head }: { g: GraphRow; width: number; height: number; head: boolean }) {
  const mid = height / 2;
  const curve = (x1: number, y1: number, x2: number, y2: number) =>
    x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;
  return (
    <svg width={width} height={height} className="graph-cell" aria-hidden>
      {g.through.map((l) => (
        <path key={`t${l}`} d={curve(x(l), 0, x(l), height)} stroke={lane(l)} />
      ))}
      {g.incoming.map((l) => (
        <path key={`i${l}`} d={curve(x(l), 0, x(g.lane), mid)} stroke={lane(l)} />
      ))}
      {g.outgoing.map((e) => (
        <path key={`o${e.to}`} d={curve(x(g.lane), mid, x(e.to), height)} stroke={lane(e.to)} />
      ))}
      {head && <circle cx={x(g.lane)} cy={mid} r={7.5} className="node-ring" stroke={lane(g.lane)} />}
      <circle cx={x(g.lane)} cy={mid} r={4.5} fill={lane(g.lane)} className="node" />
    </svg>
  );
}

type Props = {
  log: LogEntry[];
  selected: string | null;
  onSelect: (hash: string) => void;
};

/** Virtualized commit table: only visible rows are rendered. */
export function CommitGraph({ log, selected, onSelect }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowH = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--row-h")) || 26;
  const virtualizer = useVirtualizer({
    count: log.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH,
    overscan: 20,
  });
  // Density changes the row height: re-measure.
  useEffect(() => virtualizer.measure(), [rowH, virtualizer]);
  const lanes = Math.max(1, ...log.map((e) => e.graph.width));
  // Min width keeps the "Graph" header readable on simple histories.
  const graphW = Math.max(72, PAD * 2 + Math.min(lanes, 12) * LANE_W);

  function onKey(e: KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = log.findIndex((c) => c.hash === selected);
    const next = Math.min(log.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)));
    onSelect(log[next].hash);
    virtualizer.scrollToIndex(next);
  }

  return (
    <div className="commit-table" style={{ ["--graph-w" as string]: `${graphW}px` }}>
      <div className="commit-head" role="row">
        <span className="c-graph">Graph</span>
        <span className="c-msg">Message</span>
        <span className="c-author">Author</span>
        <span className="c-date">Date</span>
        <span className="c-sha">Commit</span>
      </div>
      {log.length === 0 && <div className="empty-line graph-empty">No commits yet. Stage files and make the first commit.</div>}
      <div ref={scrollRef} className="commit-scroll" tabIndex={0} onKeyDown={onKey} role="grid" aria-label="Commit history">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const e = log[item.index];
            const refs = parseRefs(e.refs);
            const isHead = refs.some((r) => r.kind === "head");
            return (
              <div
                key={e.hash}
                role="row"
                aria-selected={selected === e.hash}
                className={"commit-row" + (selected === e.hash ? " selected" : "") + (isHead ? " is-head" : "")}
                style={{ height: rowH, transform: `translateY(${item.start}px)` }}
                onClick={() => onSelect(e.hash)}
              >
                <span className="c-graph">
                  <GraphCell g={e.graph} width={graphW} height={rowH} head={isHead} />
                </span>
                <span className="c-msg">
                  {refs.map((r) => (
                    <span
                      key={r.kind + r.name}
                      className={`ref ref-${r.kind}`}
                      style={r.kind === "branch" || r.kind === "head" ? { ["--ref" as string]: lane(e.graph.lane) } : undefined}
                    >
                      {r.kind === "tag" && <Tag size={10} />}
                      {r.name}
                    </span>
                  ))}
                  <span className="subject">{e.subject}</span>
                </span>
                <span className="c-author" title={e.email}>
                  {e.author}
                </span>
                <span className="c-date" title={fullDate(e.time)}>
                  {relativeTime(e.time)}
                </span>
                <span className="c-sha mono">{e.hash.slice(0, 7)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
