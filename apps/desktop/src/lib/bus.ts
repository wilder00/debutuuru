// App-wide actions for things that live inside a repo tab (open a file in
// Files, run a fetch…), so the command palette can trigger them without
// knowing the components. Each event names its repo; only that tab acts.
import { useEffect, useRef } from "react";
import type { PullMode } from "../bindings/PullMode";

export type BusEvents = {
  /** Show `path` in Files (working tree). */
  "open-file": { repo: string; path: string };
  "show-view": { repo: string; view: "history" | "files" };
  "git-op": { repo: string; op: "fetch" | "push" } | { repo: string; op: "pull"; mode: PullMode };
  checkout: { repo: string; branch: string };
};

type Handler<K extends keyof BusEvents> = (e: BusEvents[K]) => void;
type Entry = { repo: string; fn: (e: never) => void };
// One set per event type; typed by `emit`/`useBus`, so stored loosely here.
const handlers = new Map<keyof BusEvents, Set<Entry>>();
/** "Open this file" for a tab that isn't mounted yet (a repo opened for a
 *  file): delivered as soon as that tab starts listening. */
const pending = new Map<string, BusEvents["open-file"]>();

export function emit<K extends keyof BusEvents>(type: K, event: BusEvents[K]) {
  const targets = [...(handlers.get(type) ?? [])].filter((h) => h.repo === event.repo);
  if (!targets.length && type === "open-file") pending.set(event.repo, event as BusEvents["open-file"]);
  targets.forEach((h) => (h.fn as Handler<K>)(event));
}

/** Calls `fn` for this repo's `type` events while mounted (latest `fn`). */
export function useBus<K extends keyof BusEvents>(type: K, repo: string, fn: Handler<K>) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const entry: Entry = { repo, fn: ((e: BusEvents[K]) => ref.current(e)) as (e: never) => void };
    if (!handlers.has(type)) handlers.set(type, new Set());
    const set = handlers.get(type)!;
    set.add(entry);
    const waiting = type === "open-file" ? pending.get(repo) : undefined;
    if (waiting) {
      pending.delete(repo);
      ref.current(waiting as BusEvents[K]);
    }
    return () => void set.delete(entry);
  }, [type, repo]);
}
