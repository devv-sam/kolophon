# kolophon

Design context for AI coding agents.

Agents building UI get colors and layout roughly right, but consistently miss
three things: typography specifics, computed rendering values, and motion.
Kolophon v2 is an MCP server any agent can call mid-task to extract all three
from a live URL — what the browser actually rendered, not what a stylesheet
declared.

> **Status:** v2 is in active development on the [`v2`](https://github.com/devv-sam/kolophon/tree/v2)
> branch. The MCP server is not published yet. The v1 Chrome extension below is
> what ships today.

## What it extracts

- **Typography** — font family, variable axes (weight/width ranges, optical
  sizing, custom axes), fallback stack resolution, and whether a font actually
  loaded or a fallback was silently substituted.
- **Computed values** — resolved inheritance, cascade overrides, and media query
  state, so "what font does this button use" returns what the user sees.
- **Motion** — transition durations, `cubic-bezier` easing, keyframes, and
  `prefers-reduced-motion` states.

## Output

Each extraction produces:

| Artifact | Format | Purpose |
| --- | --- | --- |
| `DESIGN.md` | Markdown | Agent-readable design brief, ending with guidance notes derived from the extracted values |
| `tokens.json` | W3C DTCG JSON | Structured tokens for Style Dictionary, Theo, and most design toolchains |
| `tailwind.config` snippet | JS/TS | Drop-in config for the project |

## Roadmap

| Phase | MCP tool(s) | Extracts |
| --- | --- | --- |
| v2.0 — Typography | `get_typography(url)` | Families, variable axes, fallbacks, load failures |
| v2.1 — Color + Scale | `get_color_palette(url)`, `get_type_scale(url)` | Perceptual color palette, type scale, role heuristics |
| v2.2 — Motion + Full Profile | `get_motion(url)`, `get_design_context(url)` | Easing, durations, keyframes, spacing, elevation — full `DESIGN.md` in one call |

## Install

Coming with v2.0. The MCP install command and a usage example will land here
once `get_typography` ships.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). v2 work branches off `v2`.

## Legacy

### v1 Chrome extension

Inspect, copy, and tweak the fonts on any web page. Click the toolbar icon, then
hover any element to see its typography, click to pin a card, tweak styles live,
and copy the CSS.

- **Inspect** — hover to highlight, click to pin a card showing font family,
  size, weight, line height, letter spacing, and color.
- **Color formats** — copy color as hex, rgb, hsl, hwb, lab, lch, oklab, or oklch.
- **Live edit** — adjust size, weight, spacing, color, and layout on the page in
  real time, then copy the changed declarations. Press Esc to discard.
- **Collection** — save fonts to a side-panel collection that persists across
  sessions, with one-click CSS copy.

Built with [WXT](https://wxt.dev) + React 19, Manifest V3.

```bash
pnpm install
pnpm dev          # launch Chrome with the extension loaded
pnpm build        # production build → .output/chrome-mv3
pnpm zip          # packaged zip for the Chrome Web Store
```

#### Permissions

- `activeTab` — connect to the current tab when you start inspecting.
- `scripting` — inject the inspector into that tab on click.
- `storage` — persist your saved collection locally.
- `clipboardWrite` — copy font specs and CSS.
- `sidePanel` — the expanded spec sheet and collection view.

The side panel fetches specimen previews from Google Fonts; local and custom
fonts fall back to a system face. No data ever leaves your device — see
[PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE) © devv-sam
