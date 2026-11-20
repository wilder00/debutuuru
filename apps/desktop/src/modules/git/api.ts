// Typed wrappers for the agent's `git.*` methods. Param and result types are
// generated from Rust (src/bindings), so a protocol change breaks the build here.
import { rpc, type Params } from "../../lib/rpc";
import type { CheckoutParams } from "../../bindings/CheckoutParams";
import type { CommitParams } from "../../bindings/CommitParams";
import type { DiffParams } from "../../bindings/DiffParams";
import type { LogEntry } from "../../bindings/LogEntry";
import type { LogParams } from "../../bindings/LogParams";
import type { PathsParams } from "../../bindings/PathsParams";
import type { Snapshot } from "../../bindings/Snapshot";

export const git = {
  snapshot: (repo: string) => rpc<Snapshot>(repo, "git.snapshot"),
  log: (repo: string, p: Params<LogParams>) => rpc<LogEntry[]>(repo, "git.log", p),
  stage: (repo: string, p: Params<PathsParams>) => rpc<null>(repo, "git.stage", p),
  unstage: (repo: string, p: Params<PathsParams>) => rpc<null>(repo, "git.unstage", p),
  commit: (repo: string, p: Params<CommitParams>) => rpc<string>(repo, "git.commit", p),
  checkout: (repo: string, p: Params<CheckoutParams>) => rpc<null>(repo, "git.checkout", p),
  diff: (repo: string, p: Params<DiffParams>) => rpc<string>(repo, "git.diff", p),
  /** Idempotent: the agent emits `git.changed` for this repo until unwatched. */
  watch: (repo: string) => rpc<null>(repo, "git.watch"),
  unwatch: (repo: string) => rpc<null>(repo, "git.unwatch"),
};

/** Event topic emitted by the agent's watcher. */
export const GIT_CHANGED = "git.changed";
