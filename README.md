# kolophon

A check for UI built by coding agents, judged on the rendered page.

kolophon opens your running app in Chrome and measures what it actually shows: which fonts were drawn and which fell back, text styles, variable font axes, transitions, keyframes, and what still moves under reduced motion. You commit the result as a baseline. After that, `kolophon check` reports anything that drifts from it.

Work in progress, and not on npm yet.

## Install

You need Node 20 or later, pnpm, and Google Chrome. kolophon doesn't download a browser. If yours isn't found, set `CHROME_PATH` to a Chrome or Chromium binary.

```bash
git clone -b v2 https://github.com/devv-sam/kolophon.git
cd kolophon
pnpm install
pnpm build
```

Then, in your app's folder:

```bash
npm install --save-dev /path/to/kolophon
```

## Use

Start your app, then record its pages. Review `kolophon.json` and commit it.

```bash
npx kolophon snapshot http://localhost:3000/ http://localhost:3000/about
```

After a change:

```bash
npx kolophon check
```

`--base-url http://localhost:4000` checks the same pages on another origin. `snapshot --update` replaces the baseline; review that diff too.

| Exit code | Meaning |
| --- | --- |
| 0 | No drift |
| 1 | Drift: each finding says what, where and what to change |
| 2 | Couldn't run, or couldn't check everything |

Pages are measured at 1280x800 and 390x844. Nothing leaves your machine apart from the requests your own pages make.

## Agents

Copy [`skills/kolophon`](skills/kolophon) into your project's `.claude/skills/`. For agents without skills, add this to your `AGENTS.md`:

```
After UI changes, run `npx --no-install kolophon check` with the app running. Exit 1 means fix the app; exit 2 is not a pass. Never run `kolophon snapshot` or edit kolophon.json unless the developer asks.
```

An agent can still change the baseline, so review changes to `kolophon.json` like code.

## Not checked

Colors, layout, dark mode, text hidden at load, shadow roots, iframes, pseudo-elements, pages behind a login, and motion started by JavaScript, scroll or hover.

## License

[MIT](LICENSE) © devv-sam
