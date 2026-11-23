// Commands of the palette (Ctrl+Shift+P). Labels follow VS Code's
// "Group: Action" style, so typing the group ("git") narrows the list.
// Commands act on the active repo tab through the bus; nothing here runs git
// itself. Destructive ones (force push) stay out of the palette on purpose.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Snapshot } from "../bindings/Snapshot";
import type { TabGroup } from "../bindings/TabGroup";
import { distinctNames } from "../lib/names";
import { LANGUAGES } from "../i18n";
import { emit } from "../lib/bus";
import { openToolWindow } from "../lib/rpc";
import { checkForUpdate } from "../lib/updater";
import { useSettings } from "../settings/SettingsProvider";
import { CUSTOM, PRESETS } from "../theme/presets";
import type { OpenActions } from "./OpenMenu";
import type { PaletteItem } from "./Palette";

type Ctx = {
  repos: string[];
  active: string | null;
  snapshot: Snapshot | null;
  open: OpenActions;
  terminal: { toggle: () => void; toggleMax: () => void; newTerminal: () => void };
  openPalette: (initial: string) => void;
  openSettings: () => void;
  refresh: () => void;
  closeTab: (repo: string) => void;
  groups: TabGroup[];
  closeGroup: (folder: string) => void;
  selectTab: (repo: string) => void;
  focusRepoInput: () => void;
};


export function useCommands(c: Ctx): PaletteItem[] {
  const { t } = useTranslation();
  const { appearance, update, language, updateLanguage, diff, updateDiff, layout, updateLayout } = useSettings();

  return useMemo(() => {
    const g = (group: "general" | "git" | "view" | "diff" | "settings" | "terminal", key: string, rest: Omit<PaletteItem, "id" | "label">): PaletteItem => ({
      id: `${group}.${key}`,
      label: `${t(`palette.group.${group}`)}: ${t(`palette.cmd.${key}` as "palette.cmd.goToFile")}`,
      ...rest,
    });
    const repo = c.active;
    const items: PaletteItem[] = [
      g("general", "goToFile", { keys: "Ctrl+P", run: () => setTimeout(() => c.openPalette(""), 0) }),
      g("general", "openFolder", { keys: "Ctrl+O", run: c.open.openFolder }),
      g("general", "openFile", { run: c.open.openFile }),
      ...c.open.distros.map((d) => ({ ...g("general", "browseWsl", { run: () => c.open.browseWsl(d) }), id: `general.browseWsl.${d}`, detail: d })),
      g("general", "openRepo", { run: c.focusRepoInput }),
      g("general", "refresh", { keys: "F5", run: c.refresh }),
      g("terminal", "toggleTerminal", { keys: "Ctrl+`", run: c.terminal.toggle }),
      g("terminal", "newTerminal", { run: c.terminal.newTerminal }),
      g("terminal", "maximizeTerminal", { run: c.terminal.toggleMax }),
      g("settings", "openSettings", { keys: "Ctrl+,", run: c.openSettings }),
      g("settings", "language", {
        pick: () => [
          { id: "lang.system", label: t("palette.systemLanguage"), detail: language === null ? "✓" : undefined, run: () => updateLanguage(null) },
          ...LANGUAGES.map((l) => ({ id: `lang.${l.code}`, label: l.name, detail: language === l.code ? "✓" : undefined, run: () => updateLanguage(l.code) })),
        ],
      }),
      g("settings", "theme", {
        pick: () => [
          ...PRESETS.map((p) => ({
            id: `theme.${p.id}`,
            label: t(`settings.theme.presets.${p.id}` as "settings.theme.presets.debutuuru", { defaultValue: p.name }),
            detail: appearance.theme === p.id ? "✓" : undefined,
            run: () => update({ theme: p.id }),
          })),
          { id: "theme.custom", label: t("settings.theme.custom"), detail: appearance.theme === CUSTOM ? "✓" : undefined, run: () => update({ theme: CUSTOM }) },
        ],
      }),
      g("settings", "style", {
        pick: () =>
          (["standard", "gamer", "circuit"] as const).map((s) => ({
            id: `style.${s}`,
            label: t(`settings.style.${s}`),
            detail: appearance.style === s ? "✓" : undefined,
            run: () => update({ style: s }),
          })),
      }),
      g("settings", "checkUpdates", { run: () => void checkForUpdate() }),
      g("view", "showLogs", { keys: "Ctrl+Shift+U", run: () => void openToolWindow("logs") }),
      g("view", "dictionary", { run: () => void openToolWindow("dictionary") }),
      g("diff", "layout", {
        pick: () =>
          (["unified", "split", "file"] as const).map((l) => ({
            id: `diff.${l}`,
            label: t(`git.diff.layouts.${l}`),
            detail: diff.layout === l ? "✓" : undefined,
            run: () => updateDiff({ layout: l }),
          })),
      }),
      ...(
        [
          ["word_highlight", "toggleWords"],
          ["ignore_whitespace", "toggleWhitespace"],
          ["syntax_highlight", "toggleSyntax"],
          ["wrap_lines", "toggleWrap"],
        ] as const
      ).map(([k, key]) => g("diff", key, { detail: diff[k] ? t("palette.on") : t("palette.off"), run: () => updateDiff({ [k]: !diff[k] }) })),
    ];
    if (c.open.recents.length || c.open.recentGroups.length) {
      items.push(
        g("general", "openRecent", {
          pick: () => {
            const all = [...c.open.recentGroups, ...c.open.recents];
            const names = distinctNames(all);
            return all.map((r, i) => ({
              id: `recent.${r}`,
              label: i < c.open.recentGroups.length ? `${names.get(r)} · ${t("open.group")}` : names.get(r)!,
              detail: r,
              run: () => c.open.openRecent(r),
            }));
          },
        }),
      );
    }
    if (c.repos.length > 1) {
      items.push(
        g("general", "switchRepo", {
          pick: () => {
            const names = distinctNames(c.repos);
            return c.repos.map((r) => ({ id: `repo.${r}`, label: names.get(r)!, detail: r, run: () => c.selectTab(r) }));
          },
        }),
      );
    }
    if (repo) {
      const local = c.snapshot?.branches.filter((b) => !b.is_remote && !b.is_head) ?? [];
      items.push(
        g("general", "closeTab", { keys: "Ctrl+W", run: () => c.closeTab(repo) }),
        ...c.groups.filter((x) => x.repos.includes(repo)).map((x) => g("general", "closeGroup", { run: () => c.closeGroup(x.folder) })),
        g("view", "history", { run: () => emit("show-view", { repo, view: "history" }) }),
        g("view", "files", { run: () => emit("show-view", { repo, view: "files" }) }),
        g("view", "toggleExpand", { run: () => emit("toggle-expand", { repo }) }),
        g("view", "toggleSidebar", { keys: "Ctrl+B", run: () => updateLayout({ sidebar: !layout.sidebar }) }),
        g("view", "toggleChanges", { keys: "Ctrl+Alt+B", run: () => updateLayout({ changes: !layout.changes }) }),
        g("view", "focusMode", {
          run: () => {
            const show = !layout.sidebar && !layout.changes;
            updateLayout({ sidebar: show, changes: show });
          },
        }),
        g("git", "fetch", { run: () => emit("git-op", { repo, op: "fetch" }) }),
        g("git", "pull", { run: () => emit("git-op", { repo, op: "pull", mode: "default" }) }),
        g("git", "pullRebase", { run: () => emit("git-op", { repo, op: "pull", mode: "rebase" }) }),
        g("git", "pullMerge", { run: () => emit("git-op", { repo, op: "pull", mode: "merge" }) }),
        g("git", "pullFfOnly", { run: () => emit("git-op", { repo, op: "pull", mode: "ff_only" }) }),
        g("git", "push", { run: () => emit("git-op", { repo, op: "push" }) }),
        g("git", "createTag", { run: () => emit("create-tag", { repo }) }),
      );
      const deletable = c.snapshot?.branches.filter((b) => !b.is_head) ?? [];
      if (deletable.length) {
        items.push(
          g("git", "deleteBranch", {
            pick: () =>
              deletable.map((b) => ({ id: `del.${b.name}`, label: b.name, detail: b.subject, run: () => emit("delete-branches", { repo, names: [b.name] }) })),
          }),
        );
      }
      const tags = c.snapshot?.tags ?? [];
      if (tags.length) {
        items.push(
          g("git", "showTag", {
            pick: () => tags.map((x) => ({ id: `tag.${x.name}`, label: x.name, detail: x.annotated ? x.message.split("\n")[0] : x.commit_subject, run: () => emit("show-tag", { repo, name: x.name }) })),
          }),
        );
      }
      if (local.length) {
        items.push(
          g("git", "checkout", {
            pick: () => local.map((b) => ({ id: `branch.${b.name}`, label: b.name, detail: b.subject, run: () => emit("checkout", { repo, branch: b.name }) })),
          }),
        );
      }
    }
    return items;
  }, [t, c, appearance.theme, appearance.style, update, language, updateLanguage, diff, updateDiff, layout, updateLayout]);
}
