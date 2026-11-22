// Decorative circuit traces for the Circuit style (welcome screen, drop
// overlay): lines coming in from both sides with 45° bends and solder pads,
// accent on the left, the gradient's green on the right. Colors come from the
// theme tokens; CSS only shows it in the Circuit style.
import { useId } from "react";

type Trace = { d: string; pad: [number, number] };

/** Deterministic traces for one side (x grows toward the center). */
function side(): Trace[] {
  const out: Trace[] = [];
  for (let i = 0; i < 11; i++) {
    const y = 140 + i * 30;
    const len = 150 + ((i * 73) % 190);
    const jog = (i % 3) - 1; // -1, 0, 1: bend up, straight, bend down
    const bendX = len - 40 - ((i * 37) % 60);
    const y2 = y + jog * 18;
    const d = jog ? `M0 ${y}H${bendX}L${bendX + 18} ${y2}H${len}` : `M0 ${y}H${len}`;
    out.push({ d, pad: [len, y2] });
  }
  return out;
}

const TRACES = side();

export function CircuitTraces() {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const fade = (color: string, flip: boolean) => (
    <linearGradient id={`${id}-${flip ? "r" : "l"}`} x1={flip ? "1" : "0"} x2={flip ? "0" : "1"} y1="0" y2="0">
      <stop offset="0" style={{ stopColor: color, stopOpacity: 0 }} />
      <stop offset="0.6" style={{ stopColor: color, stopOpacity: 0.55 }} />
      <stop offset="1" style={{ stopColor: color, stopOpacity: 0.9 }} />
    </linearGradient>
  );
  const group = (flip: boolean) => (
    <g transform={flip ? "translate(1200 0) scale(-1 1)" : undefined} style={{ fill: "none", strokeWidth: 1.4 }}>
      {TRACES.map((t, i) => (
        <g key={i}>
          <path d={t.d} style={{ stroke: `url(#${id}-${flip ? "r" : "l"})` }} />
          <circle cx={t.pad[0]} cy={t.pad[1]} r={2.6} style={{ fill: flip ? "var(--grad-end)" : "var(--accent)", filter: "drop-shadow(0 0 3px var(--accent-ring))" }} />
        </g>
      ))}
    </g>
  );
  return (
    <svg className="circuit-traces" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        {fade("var(--accent)", false)}
        {fade("var(--grad-end)", true)}
      </defs>
      {group(false)}
      {group(true)}
    </svg>
  );
}
