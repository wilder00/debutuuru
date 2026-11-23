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

/** cmd.exe can't start in a `\\wsl.localhost\…` folder (it falls back to
 *  C:\Windows with a warning), but its `pushd` can go there; PowerShell and
 *  Git Bash start there directly. */
const isCmd = (program: string) => /(^|[\\/])cmd(\.exe)?$/i.test(program);

/** What to run for `profile`, starting in `repo`'s folder whenever the shell
 *  can reach it: a WSL shell in a repo of its own distro (Linux path) or of
 *  Windows (`wsl --cd` takes Windows paths: `C:\…` → `/mnt/c/…`); a Windows
 *  shell in a Windows repo, or in a WSL repo through `\\wsl.localhost\…`.
 *  A profile's own folder wins; otherwise it falls back to home. */
export function spawnParams(profile: TerminalProfile, repo: string | null, cols: number, rows: number): SpawnParams {
  const distro = repo ? wslDistro(repo) : null;
  const args = [...profile.args];
  let cwd = profile.cwd ?? undefined;
  if (profile.wsl_distro) {
    if (!args.includes("--cd")) {
      const here = !repo ? null : !distro ? repo : distro.toLowerCase() === profile.wsl_distro.toLowerCase() ? linuxPath(repo) : null;
      args.push("--cd", cwd ?? here ?? "~");
    }
    cwd = undefined;
  } else if (!cwd && repo && distro && isCmd(profile.program)) {
    // `pushd` maps the WSL folder to a free drive letter for this session.
    // Separate arguments: the command line quotes the path only if needed.
    if (!args.some((a) => /^\/[ck]$/i.test(a))) args.push("/K", "pushd", repo);
  } else if (!cwd && repo) {
    cwd = repo;
  }
  return { program: profile.program, args, cwd, env: profile.env, cols, rows };
}

/** The default profile, or the first one available. */
export function pickDefault(all: TerminalProfile[], id: string | null): TerminalProfile | null {
  return all.find((p) => p.id === id) ?? all[0] ?? null;
}
