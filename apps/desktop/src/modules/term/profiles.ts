// Terminal profiles: the ones found on this machine (the shell's
// `term_profiles`) plus the user's own, and how a profile starts in the open
// repository's folder.
import { invoke } from "@tauri-apps/api/core";
import type { SpawnParams } from "../../bindings/SpawnParams";
import type { TerminalProfile } from "../../bindings/TerminalProfile";
import { wslDistro } from "../../lib/rpc";

let detected: Promise<TerminalProfile[]> | null = null;

/** Found once per run (checking WSL distros takes a moment). */
export const detectedProfiles = () => (detected ??= invoke<TerminalProfile[]>("term_profiles").catch(() => []));

/** `\\wsl.localhost\Ubuntu\home\me\app` → `/home/me/app`. */
const linuxPath = (repo: string) => repo.replace(/^\\\\wsl(?:\$|\.localhost)\\[^\\]+/i, "").replace(/\\/g, "/") || "/";

/** What to run for `profile`, starting in `repo` when it fits the profile. */
export function spawnParams(profile: TerminalProfile, repo: string | null, cols: number, rows: number): SpawnParams {
  const distro = repo ? wslDistro(repo) : null;
  const args = [...profile.args];
  let cwd = profile.cwd ?? undefined;
  if (profile.wsl_distro) {
    // A WSL shell starts in the repo when it's in the same distro.
    if (!args.includes("--cd")) args.push("--cd", repo && distro?.toLowerCase() === profile.wsl_distro.toLowerCase() ? linuxPath(repo) : (cwd ?? "~"));
    cwd = undefined;
  } else if (!cwd && repo && !distro) {
    cwd = repo;
  }
  return { program: profile.program, args, cwd, env: profile.env, cols, rows };
}

/** The default profile, or the first one available. */
export function pickDefault(all: TerminalProfile[], id: string | null): TerminalProfile | null {
  return all.find((p) => p.id === id) ?? all[0] ?? null;
}
