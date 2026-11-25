# kolophon

A design check for UI built by coding agents. It opens your running app in Chrome, measures the fonts, text styles and motion it really shows, and reports what drifts from a baseline you committed.

Work in progress. Not on npm yet.

## Install

Needs Node 20+, pnpm and Chrome.

```bash
git clone https://github.com/devv-sam/kolophon.git
cd kolophon && pnpm install && pnpm build
```

Then, in your app:

```bash
npm install --save-dev /path/to/kolophon
```

## Use

```bash
npx kolophon snapshot http://localhost:3000/   # writes kolophon.json: review and commit it
npx kolophon check                             # after a change
```

`check` exits 0 for no drift, 1 for drift, and 2 if it couldn't check everything. Run `npx kolophon --help` for options.

For coding agents, copy [`skills/kolophon`](skills/kolophon) into `.claude/skills/`. It also lists what isn't checked.

## License

[MIT](LICENSE) © devv-sam
