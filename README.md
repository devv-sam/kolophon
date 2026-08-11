# kolophon

Inspect, copy, and tweak the fonts on any web page. Hover to reveal type, copy CSS, edit live, and save fonts you love.

A Chrome extension for designers and developers. Click the toolbar icon, then
hover any element to see its typography, click to pin a card, tweak styles live,
and copy the CSS. Build a collection of fonts you find in the wild.

## Features

- **Inspect** — hover to highlight, click to pin a card showing font family,
  size, weight, line height, letter spacing, and color.
- **Color formats** — copy color as hex, rgb, hsl, hwb, lab, lch, oklab, or oklch.
- **Live edit** — adjust size, weight, spacing, color, and layout on the page in
  real time, then copy the changed declarations. Press Esc to discard.
- **Collection** — save fonts to a side-panel collection that persists across
  sessions, with one-click CSS copy.

## Tech

Built with [WXT](https://wxt.dev) + React 19. Manifest V3.

## Development

Requires Node 20+ and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev          # launch Chrome with the extension loaded
pnpm compile      # typecheck
pnpm build        # production build → .output/chrome-mv3
pnpm zip          # packaged zip for the Chrome Web Store
```

## Permissions

- `activeTab` — connect to the current tab when you start inspecting.
- `storage` — persist your saved collection locally.
- `clipboardWrite` — copy font specs and CSS.
- `sidePanel` — the expanded spec sheet and collection view.

The side panel fetches specimen previews from Google Fonts; local and custom
fonts fall back to a system face.

No data ever leaves your device — see [PRIVACY.md](PRIVACY.md).

## Contributing

Issues and pull requests are welcome. Please run `pnpm compile` before opening a
PR, and keep changes focused — one concern per PR.

## License

[MIT](LICENSE) © devv-sam
