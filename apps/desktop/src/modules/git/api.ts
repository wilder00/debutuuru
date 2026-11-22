// Typed wrappers for the agent's `git.*` methods. Param and result types are
// generated from Rust (src/bindings), so a protocol change breaks the build here.
import { rpc, type Params } from "../../lib/rpc";
import type { CheckoutParams } from "../../bindings/CheckoutParams";
import type { CommitParams } from "../../bindings/CommitParams";
import type { FetchParams } from "../../bindings/FetchParams";
import type { OpOutcome } from "../../bindings/OpOutcome";
import type { PullParams } from "../../bindings/PullParams";
import type { PushParams } from "../../bindings/PushParams";
import type { LogEntry } from "../../bindings/LogEntry";
import type { LogParams } from "../../bindings/LogParams";
import type { PathsParams } from "../../bindings/PathsParams";
import type { Snapshot } from "../../bindings/Snapshot";
import type { FileContent } from "../../bindings/FileContent";
import type { ReadFileParams } from "../../bindings/ReadFileParams";
import type { TreeEntry } from "../../bindings/TreeEntry";
import type { TreeParams } from "../../bindings/TreeParams";
import type { CommitDetails } from "../../bindings/CommitDetails";
import type { FileVersions } from "../../bindings/FileVersions";
import type { FileVersionsParams } from "../../bindings/FileVersionsParams";
import type { RevParams } from "../../bindings/RevParams";
import type { EntryKind } from "../../bindings/EntryKind";
import type { FileBytes } from "../../bindings/FileBytes";
import type { StatPathsParams } from "../../bindings/StatPathsParams";

export const git = {
  snapshot: (repo: string) => rpc<Snapshot>(repo, "git.snapshot"),
  log: (repo: string, p: Params<LogParams>) => rpc<LogEntry[]>(repo, "git.log", p),
  stage: (repo: string, p: Params<PathsParams>) => rpc<null>(repo, "git.stage", p),
  unstage: (repo: string, p: Params<PathsParams>) => rpc<null>(repo, "git.unstage", p),
  commit: (repo: string, p: Params<CommitParams>) => rpc<string>(repo, "git.commit", p),
  checkout: (repo: string, p: Params<CheckoutParams>) => rpc<null>(repo, "git.checkout", p),
  /** One folder level; `rev` omitted = working tree. */
  tree: (repo: string, p: Params<TreeParams>) => rpc<TreeEntry[]>(repo, "git.tree", p),
  readFile: (repo: string, p: Params<ReadFileParams>) => rpc<FileContent>(repo, "git.read_file", p),
  /** What each path is (file, folder…) or null: up to 64 per call. */
  statPaths: (repo: string, p: Params<StatPathsParams>) => rpc<(EntryKind | null)[]>(repo, "git.stat_paths", p),
  /** A file's bytes as base64 (≤ 10 MiB), for images. */
  readBytes: (repo: string, p: Params<ReadFileParams>) => rpc<FileBytes>(repo, "git.read_bytes", p),
  /** Message, author and the files changed against the first parent. */
  commitDetails: (repo: string, p: Params<RevParams>) => rpc<CommitDetails>(repo, "git.commit_details", p),
  /** Both versions of a file (unstaged, staged, untracked or in a commit). */
  fileVersions: (repo: string, p: Params<FileVersionsParams>) => rpc<FileVersions>(repo, "git.file_versions", p),
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
