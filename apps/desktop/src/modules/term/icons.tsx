// Profile icons: the shell's or distro's logo (simple-icons, CC0) drawn in
// the current text color, so it follows the theme like every other icon.
// PowerShell's logo isn't in simple-icons; lucide's `>_` stands in for it.
// A profile may name one (`icon`); otherwise it's guessed from the WSL distro
// or the program.
import { SquareTerminal, Terminal } from "lucide-react";
import {
  siAlpinelinux,
  siArchlinux,
  siDebian,
  siFishshell,
  siFedora,
  siGitforwindows,
  siGnubash,
  siKalilinux,
  siLinux,
  siLinuxmint,
  siNushell,
  siOpensuse,
  siUbuntu,
  siZsh,
} from "simple-icons";
import type { TerminalProfile } from "../../bindings/TerminalProfile";

const ICONS: Record<string, { title: string; path: string }> = {
  git: siGitforwindows,
  bash: siGnubash,
  zsh: siZsh,
  fish: siFishshell,
  nushell: siNushell,
  linux: siLinux,
  ubuntu: siUbuntu,
  debian: siDebian,
  arch: siArchlinux,
  fedora: siFedora,
  opensuse: siOpensuse,
  alpine: siAlpinelinux,
  kali: siKalilinux,
  mint: siLinuxmint,
};

/** Icon names a profile can pick (plus "terminal", the generic one). */
export const ICON_NAMES = ["terminal", "powershell", ...Object.keys(ICONS)];

/** Brand name for an icon (not translated); `null` for the generic one. */
export const iconTitle = (name: string) => (name === "powershell" ? "PowerShell" : (ICONS[name]?.title ?? null));

/** Best guess from the distro name or the program. */
export function guessIcon(p: TerminalProfile): string {
  const distro = p.wsl_distro?.toLowerCase();
  if (distro) return Object.keys(ICONS).find((k) => k !== "linux" && distro.includes(k)) ?? "linux";
  const prog = p.program.toLowerCase().split(/[\\/]/).pop() ?? "";
  if (/^(pwsh|powershell)/.test(prog)) return "powershell";
  if (prog.startsWith("bash") && p.program.toLowerCase().includes("git")) return "git";
  if (prog.startsWith("bash")) return "bash";
  if (prog.startsWith("zsh")) return "zsh";
  if (prog.startsWith("fish")) return "fish";
  if (prog === "nu" || prog.startsWith("nu.")) return "nushell";
  if (prog.startsWith("wsl")) return "linux";
  return "terminal";
}

export function ProfileIcon({ profile, size = 14 }: { profile: TerminalProfile; size?: number }) {
  const name = profile.icon ?? guessIcon(profile);
  if (name === "powershell") return <Terminal size={size} className="profile-icon" aria-hidden />;
  const icon = ICONS[name];
  if (!icon) return <SquareTerminal size={size} className="profile-icon" aria-hidden />;
  return (
    <svg className="profile-icon" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d={icon.path} />
    </svg>
  );
}
