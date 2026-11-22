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
// One set per event type; typed by `emit`/`useBus`, so stored loosely here.
const handlers = new Map<keyof BusEvents, Set<(e: never) => void>>();

export function emit<K extends keyof BusEvents>(type: K, event: BusEvents[K]) {
  handlers.get(type)?.forEach((h) => (h as Handler<K>)(event));
}

/** Calls `fn` for this repo's `type` events while mounted (latest `fn`). */
export function useBus<K extends keyof BusEvents>(type: K, repo: string, fn: Handler<K>) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h: Handler<K> = (e) => e.repo === repo && ref.current(e);
    if (!handlers.has(type)) handlers.set(type, new Set());
    const set = handlers.get(type)!;
    set.add(h as (e: never) => void);
    return () => void set.delete(h as (e: never) => void);
  }, [type, repo]);
}
