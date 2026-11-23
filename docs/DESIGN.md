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

One exception, chosen on purpose: file icons in the Files tree come from
Material Icon Theme (MIT, as in VS Code) and keep their own colors by
default, because the color is how you recognize a file type at a glance.
Settings › File icons › Theme color draws the same shapes with
`--text-muted` (files) and `--accent` (folders) instead.

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
| `--syn-keyword`, `-string`, `-number`, `-constant`, `-function`, `-type`, `-property` | equal lightness (≥ lanes), fixed conventional hues | syntax highlighting in the file viewer |
| `--syn-comment` | muted text | code comments (italic) |

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
  and **dim**. Panels become translucent so the image shows through
  evenly across the whole window (no extra blur on panels: it made the side
  panels look like a separate layer; the image's Blur setting blurs it
  everywhere instead), while text keeps contrast through the dim layer.
- **Fonts**: UI and mono family (any installed font, falling back to the
  bundled ones), base size, code ligatures on/off.
- **Density**: compact / comfortable.
- **Style**: Standard (everything above), Gamer or Circuit (below).

## Styles

A style changes how the tokens are used, never the tokens themselves, so it
works with every theme (presets or custom) and the contrast report still
applies. It's set on `<html data-style>` and lives in `styles.css`.

- **Standard**: the calm design described in this document.
- **Gamer**: neon glow (`--accent-ring`) on what's active, focused or
  selected; sharper corners (radius 3/5 px); borders tinted with the accent;
  and RGB bars (title bar, status bar, active tab, logo) drawn with the
  commit-graph lane palette, which has equal lightness and hues rotated from
  the accent, so it suits any theme. The Neon, Cyberpunk, Crimson and Toxic
  presets are made for it; Cyberpunk and Crimson use lighter accents than
  their pure neon color so button text keeps 4.5:1.
- **Circuit**: based on an electric blue/green gaming banner. A two-color
  gradient from the accent to a green derived from it (`oklch(from
  var(--accent) …)`, 95° toward green at the accent's chroma; the lane 90°
  away is the fallback), a carbon texture on surfaces, decorative circuit
  traces on the welcome screen and the drop overlay, and **Exo 2** (OFL,
  bundled, bold italic) for the logo, headings and primary buttons. Body
  text stays Inter. The Circuit preset (navy + electric blue) is made for
  it; its accent was chosen so button text keeps 8:1.
- **Motion exception**: with "Animated RGB" on (the default for Gamer), the
  RGB bars cycle their colors continuously (Gamer) or a light sweeps across
  the gradient bars (Circuit), beyond the 120 ms rule above.
  It's opt-in through the style, has its own switch, and the global
  `prefers-reduced-motion` rule turns it off.
- **Motion budget**: a running animation makes the webview draw ~60 frames a
  second, about a third of a CPU core however small it is; an animated
  background repaints too and cost a whole core. So decorative motion only
  animates `transform`/`opacity` (`FxBar.tsx`), pauses while the window
  isn't focused or is minimized (`data-active`), and Circuit's sweep runs
  once every 7 s instead of nonstop (`data-sweep`), with nothing running in
  between. Measure idle CPU before adding any decorative motion.

Later: import Warp `.yaml` themes, share themes as files, light mode (the
generator supports it; it needs its own lightness curve).
