// Typed wrappers for the agent's `fs.*` methods: a plain folder (not a
// repository), read-only. Paths are relative to the folder.
import { rpc, type Params } from "../../lib/rpc";
import type { EntryKind } from "../../bindings/EntryKind";
import type { FileBytes } from "../../bindings/FileBytes";
import type { FileContent } from "../../bindings/FileContent";
import type { FolderPathParams } from "../../bindings/FolderPathParams";
import type { FolderPathsParams } from "../../bindings/FolderPathsParams";
import type { TreeEntry } from "../../bindings/TreeEntry";

export const fs = {
  /** One level; repositories inside come as `submodule`. */
  tree: (folder: string, p: Params<FolderPathParams>) => rpc<TreeEntry[]>(folder, "fs.tree", p),
  readFile: (folder: string, p: Params<FolderPathParams>) => rpc<FileContent>(folder, "fs.read_file", p),
  readBytes: (folder: string, p: Params<FolderPathParams>) => rpc<FileBytes>(folder, "fs.read_bytes", p),
  statPaths: (folder: string, p: Params<FolderPathsParams>) => rpc<(EntryKind | null)[]>(folder, "fs.stat_paths", p),
  /** Every file outside the repositories inside, for quick open. */
  listFiles: (folder: string) => rpc<string[]>(folder, "fs.list_files"),
  /** Idempotent: the agent emits `fs.changed` for this folder until unwatched. */
  watch: (folder: string) => rpc<null>(folder, "fs.watch"),
  unwatch: (folder: string) => rpc<null>(folder, "fs.unwatch"),
};

export const FS_CHANGED = "fs.changed";
