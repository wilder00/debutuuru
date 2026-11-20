# Debutuuru design system

Goal: a calm, dense, keyboard-friendly dark UI that feels like the tools
developers already live in (editor, terminal), and that each developer can make
their own, Warp-style (theme, accent, background image).

## Research → rules

| Source | What we take |
| --- | --- |
| [Material dark theme](https://m2.material.io/design/color/dark-theme) | Dark **grey, not black** (less eye strain, shadows stay visible). **Higher surfaces are lighter**, not just shadowed. **Desaturate accents** so text keeps WCAG AA (4.5:1) contrast. |
| [Linear UI redesign](https://linear.app/blog/how-we-redesigned-the-linear-ui) | Generate the whole theme from **3 inputs: base, accent, contrast**, in a **perceptual color space** (LCH, here OKLCH) so every hue gets the same perceived lightness. The same inputs drive a high-contrast mode. |
| [Radix Colors scales](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) | A **12-step scale with fixed meanings**: 1–2 app and subtle backgrounds, 3–5 component backgrounds (normal, hover, active), 6–8 borders, 9–10 solid fills, 11 secondary text, 12 primary text. |
| [Warp custom themes](https://docs.warp.dev/terminal/appearance/custom-themes) | Personalization users already like: **accent**, **background image with an opacity value**, **darker/lighter details**, gradients. |
| Font guides ([pairing](https://fontalternatives.com/pairings/inter-and-jetbrains-mono/), [2026 picks](https://draculatheme.com/blog/best-fonts-for-programming-2026)) | **Inter** for UI and **JetBrains Mono** for code, with near-identical metrics. Ligatures **off in UI**, available for code. Both are OFL and bundled, so they work offline. |

## Tokens

The UI only uses semantic tokens (CSS variables). Themes produce them, and
components never use raw colors.

| Token | Scale step | Use |
| --- | --- | --- |
| `--bg-app` | 1 | window background |
| `--bg-panel` | 2 | sidebars, panels |
| `--bg-raised` | 3 | inputs, cards, menus |
| `--bg-hover` / `--bg-active` | 4 / 5 | interactive states |
| `--border-subtle` / `--border` / `--border-strong` | 6 / 7 / 8 | separators, controls, focus-adjacent |
| `--accent` / `--accent-hover` | 9 / 10 | primary buttons, selection, focus ring |
| `--accent-soft` | accent at low alpha | selected rows, chips |
| `--text-muted` / `--text` | 11 / 12 | secondary / primary text |
| `--ok`, `--warn`, `--danger`, `--info` | same OKLCH lightness | git status (added, modified, deleted, renamed) |
| `--lane-0…7` | equal lightness, hues rotated from the accent | commit graph lanes, consistent brightness |

Typography: UI 13px (configurable 12–15), mono for hashes, paths, diffs and
counts. Radius 6px for controls and 10px for panels. Spacing on a 4px grid, with
"compact" and "comfortable" densities. Focus is always visible (2px accent
ring). Motion is limited to 120 ms opacity/background transitions and is
disabled under `prefers-reduced-motion`.

## Layout (developer-tool conventions)

```
┌ Title bar: repo path · branch · open/refresh ─────────────────── settings ┐
├──┬──────────────┬───────────────────────────────────────┬─────────────────┤
│A │ Sidebar      │ Commit graph (virtualized table)      │ Changes         │
│c │  branches    │  graph · message · author · date · sha│  staged         │
│t │  remotes     ├───────────────────────────────────────┤  unstaged       │
│i │  worktrees   │ Diff (opens when a file is selected)  │  commit box     │
│v │              │                                       │                 │
├──┴──────────────┴───────────────────────────────────────┴─────────────────┤
│ Status bar: worktree kind · ahead/behind · agent (os, protocol) · version │
└──────────────────────────────────────────────────────────────────────────┘
```

The activity bar on the left is where future modules appear (terminal, forge,
containers), like VS Code.

## Personalization

Stored in the app's settings file (`settings.json`, with `schema_version`;
see VERSIONING). Everything previews live.

- **Theme**: a preset, or custom **base + accent + contrast**.
- **Background image** (as in Warp): pick any PNG/JPEG/WebP/GIF. It's copied
  into the app's data folder, and you set its **visibility** (opacity), **blur**
  and **dim**. Panels become translucent (with backdrop blur) so the image shows
  through, while text keeps contrast through the dim layer.
- **Fonts**: UI and mono family (any installed font, falling back to the
  bundled ones), base size, code ligatures on/off.
- **Density**: compact / comfortable.

Later: import Warp `.yaml` themes, share themes as files, light mode (the
generator supports it; it needs its own lightness curve).
