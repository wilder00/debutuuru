import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";

/**
 * File and folder icons of the Files tree, from Material Icon Theme (MIT):
 * - `virtual:file-icons`: its name → icon map (the package's VS Code
 *   manifest, ~450 KB) reduced at build time to what the tree uses;
 * - `/file-icons/<icon>.svg`: the icons it maps to, served from the package
 *   in dev and copied into the build, so each loads only when shown.
 */
function fileIcons(): Plugin {
  const id = "virtual:file-icons";
  const manifestPath = createRequire(import.meta.url).resolve("material-icon-theme/dist/material-icons.json");
  const iconsDir = join(dirname(manifestPath), "..", "icons");
  const manifest = () => JSON.parse(readFileSync(manifestPath, "utf8"));
  const svg = (m: { iconDefinitions: Record<string, { iconPath: string }> }, icon: string) => basename(m.iconDefinitions[icon].iconPath, ".svg");
  const safe = /^[\w.-]+\.svg$/;
  return {
    name: "file-icons",
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(resolved) {
      if (resolved !== `\0${id}`) return;
      const m = manifest();
      const map = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, svg(m, v)]));
      const icons = {
        file: svg(m, m.file),
        folder: svg(m, m.folder),
        folderOpen: svg(m, m.folderExpanded),
        ext: map(m.fileExtensions),
        names: map(m.fileNames),
        folders: map(m.folderNames),
        foldersOpen: map(m.folderNamesExpanded),
      };
      return `export default ${JSON.stringify(icons)};`;
    },
    configureServer(server) {
      server.middlewares.use("/file-icons/", (req, res, next) => {
        const name = decodeURIComponent((req.url ?? "").split("?")[0].replace(/^\//, ""));
        if (!safe.test(name)) return next();
        try {
          const body = readFileSync(join(iconsDir, name));
          res.setHeader("Content-Type", "image/svg+xml");
          res.setHeader("Cache-Control", "max-age=3600");
          res.end(body);
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      const m = manifest();
      for (const icon of new Set(Object.keys(m.iconDefinitions).map((i) => svg(m, i)))) {
        this.emitFile({ type: "asset", fileName: `file-icons/${icon}.svg`, source: readFileSync(join(iconsDir, `${icon}.svg`)) });
      }
    },
  };
}

// Tauri loads http://localhost:1420 in dev (see src-tauri/tauri.conf.json).
export default defineConfig({
  plugins: [react(), fileIcons()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Rust changes are rebuilt by cargo, not Vite.
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
