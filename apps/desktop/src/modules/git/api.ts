// Typed wrappers for the agent's `git.*` methods. Param and result types are
// generated from Rust (src/bindings), so a protocol change breaks the build here.
import { rpc, type Params } from "../../lib/rpc";
import type { CheckoutParams } from "../../bindings/CheckoutParams";
import type { CommitParams } from "../../bindings/CommitParams";
import type { DiffParams } from "../../bindings/DiffParams";
import type { FetchParams } from "../../bindings/FetchParams";
import type { OpOutcome } from "../../bindings/OpOutcome";
import type { PullParams } from "../../bindings/PullParams";
import type { PushParams } from "../../bindings/PushParams";
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
  fetch: (repo: string, p: Params<FetchParams>) => rpc<OpOutcome>(repo, "git.fetch", p),
  pull: (repo: string, p: Params<PullParams>) => rpc<OpOutcome>(repo, "git.pull", p),
  push: (repo: string, p: Params<PushParams>) => rpc<OpOutcome>(repo, "git.push", p),
  cancel: (repo: string, opId: string) => rpc<null>(repo, "git.cancel", { op_id: opId }),
  promptReply: (repo: string, id: string, answer: string | null) => rpc<null>(repo, "git.prompt_reply", { id, answer }),
};

/** Event topics emitted by the git module. */
export const GIT_CHANGED = "git.changed";
export const GIT_PROGRESS = "git.progress";
export const GIT_PROMPT = "git.prompt";
