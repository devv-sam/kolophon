---
name: kolophon
description: Check that UI changes keep to the app's own design, as the browser actually renders it. Use after changing anything that affects text, fonts, sizes, spacing of type, transitions, animations or reduced motion, and before saying UI work is done, in a project that has a kolophon.json.
---

# kolophon

`kolophon check` opens the running app in Chrome, measures the text styles, fonts and motion it really shows, and compares them with `kolophon.json`. The developer reviewed and committed that file. It's theirs.

## Run it

1. Make sure the app is running.
2. From the folder that has `kolophon.json`:

   ```bash
   npx --no-install kolophon check
   ```

   If the app runs somewhere other than the `baseUrl` in that file, add `--base-url http://localhost:PORT`.

## Read the exit code

| Code | Meaning | What to do |
| --- | --- | --- |
| 0 | No drift | Done. Notes don't need fixing, but read them: a style you removed by accident shows up there. |
| 1 | Drift | Fix the app, then run it again. |
| 2 | Couldn't check everything | Not a pass. Do what the message says, or tell the developer. |

## Fix drift

- Fix the app's code. Each `DRIFT` block says what was found, where (page, viewport and selector) and a fix. One cause is one block, so find the one declaration behind it.
- `hint` lines are the nearest baseline values. They can be wrong: if a design document or design tokens exist, those decide.
- "didn't draw its text" means another font was drawn. Look at the font file, its `@font-face` and the family name. A font that looks right to you may be installed only on this machine.
- If drift isn't yours, say so to the developer. Fix it only if that's part of your task.

## Leave the baseline alone

Never run `kolophon snapshot`, and never edit or delete `kolophon.json`, to make a check pass. If the change was asked for and the check rightly reports it, stop and tell the developer what changed and that they can run `kolophon snapshot <url...> --update` and review the diff. Run it yourself only if the developer asks you to in this conversation.

## Report

Say which exit code you got, what you fixed, and anything left. Never call exit 2 a pass.

It doesn't see colors, layout, dark mode, hidden text, shadow roots, iframes, or motion started by JavaScript, scroll or hover. A pass says nothing about those.
