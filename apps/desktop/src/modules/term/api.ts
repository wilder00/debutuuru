// Terminal module (`term.*`): every terminal runs in the local agent (ConPTY on
// Windows, a PTY on Linux; WSL profiles run `wsl.exe -d <distro>` there, like
// Windows Terminal). Output arrives as agent events; they're collected by one
// listener and buffered per terminal, because the first output (ConPTY's
// cursor query, which must be answered) can arrive before `spawn` returns.
import type { ExitEvent } from "../../bindings/ExitEvent";
import type { OutputEvent } from "../../bindings/OutputEvent";
import type { Spawned } from "../../bindings/Spawned";
import type { SpawnParams } from "../../bindings/SpawnParams";
import { onAgentEvent, rpc } from "../../lib/rpc";

/** Terminals always run in the local agent (repo "" routes there). */
const call = <T>(method: string, params: object) => rpc<T>("", method, params);

export const term = {
  spawn: (p: SpawnParams) => call<Spawned>("term.spawn", p),
  write: (id: string, data: string) => call<null>("term.write", { id, data }),
  resize: (id: string, cols: number, rows: number) => call<null>("term.resize", { id, cols, rows }),
  kill: (id: string) => call<null>("term.kill", { id }),
};

type Listener = { output: (data: string) => void; exit: (code: number | null) => void };
type Pending = { output: string[]; exit?: number | null };

const listeners = new Map<string, Listener>();
const pending = new Map<string, Pending>();
let started = false;

function start() {
  if (started) return;
  started = true;
  void onAgentEvent((e) => {
    if (e.topic === "term.output") {
      const o = e.payload as OutputEvent;
      const l = listeners.get(o.id);
      if (l) l.output(o.data);
      else (pending.get(o.id) ?? pending.set(o.id, { output: [] }).get(o.id)!).output.push(o.data);
    } else if (e.topic === "term.exit") {
      const x = e.payload as ExitEvent;
      const l = listeners.get(x.id);
      if (l) l.exit(x.code);
      else (pending.get(x.id) ?? pending.set(x.id, { output: [] }).get(x.id)!).exit = x.code;
    }
  });
}

/** Call before `spawn`, so no early output is lost. */
export const listenTerminals = start;

/** Output and exit of terminal `id`, including what arrived before. */
export function subscribe(id: string, l: Listener): () => void {
  start();
  listeners.set(id, l);
  const p = pending.get(id);
  if (p) {
    pending.delete(id);
    p.output.forEach((d) => l.output(d));
    if (p.exit !== undefined) l.exit(p.exit);
  }
  return () => {
    listeners.delete(id);
    pending.delete(id);
  };
}
