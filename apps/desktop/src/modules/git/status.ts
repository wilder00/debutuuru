import type { TFunction } from "i18next";

const LETTERS = ["M", "A", "D", "R", "C", "?", "U"] as const;

/** "modified", "untracked"… for a git status letter, in the UI language. */
export function statusName(t: TFunction, letter: string): string {
  return (LETTERS as readonly string[]).includes(letter) ? t(`git.status.${letter as (typeof LETTERS)[number]}`) : letter;
}
