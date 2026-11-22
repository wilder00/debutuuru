// File and folder icons in the Files tree, from Material Icon Theme (MIT,
// the VS Code icon theme): a TypeScript file, a `src` folder, `package.json`,
// a Dockerfile… each gets its own. The name → icon map comes from the
// package at build time (`virtual:file-icons`), and each SVG is served as
// `/file-icons/<icon>.svg`, loaded when first shown (see vite.config.ts).
//
// The icons keep their own colors by default (a documented exception to the
// theme-token rule, docs/DESIGN.md); Settings › File icons can paint them
// with the theme's color instead.
import icons from "virtual:file-icons";
import { useSettings } from "../../settings/SettingsProvider";

const url = (icon: string) => `/file-icons/${icon}.svg`;

/** Icon for a file name: its exact name first, then its extensions, longest first (`a.test.tsx` → `test.tsx`, `tsx`). */
export function fileIcon(name: string): string {
  const lower = name.toLowerCase();
  const byName = icons.names[name] ?? icons.names[lower];
  if (byName) return byName;
  for (let i = lower.indexOf("."); i !== -1; i = lower.indexOf(".", i + 1)) {
    const ext = icons.ext[name.slice(i + 1)] ?? icons.ext[lower.slice(i + 1)];
    if (ext) return ext;
  }
  return icons.file;
}

export function folderIcon(name: string, open: boolean): string {
  const map = open ? icons.foldersOpen : icons.folders;
  return map[name] ?? map[name.toLowerCase()] ?? (open ? icons.folderOpen : icons.folder);
}

/** `name` is the file or folder name (not the path). */
export function FileIcon({ name, folder = false, open = false }: { name: string; folder?: boolean; open?: boolean }) {
  const { appearance } = useSettings();
  const src = url(folder ? folderIcon(name, open) : fileIcon(name));
  // Theme mode: the icon's shape, filled with the theme's color.
  if (appearance.file_icons === "theme") {
    return <span className={"ficon ficon-mask" + (folder ? " dir" : "")} aria-hidden style={{ maskImage: `url("${src}")` }} />;
  }
  return <img className="ficon ficon-img" src={src} alt="" aria-hidden draggable={false} />;
}
