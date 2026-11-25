# Contributing to kolophon

Issues and pull requests are welcome.

## Branches

v2 work happens on the `v2` branch. Branch features off `v2`, not `main`, and
open PRs against `v2`. Nothing merges to `main` until a phase is stable.

## Commits

[Conventional commits](https://www.conventionalcommits.org), one-line subject,
present tense, under 72 characters:

```
feat: add retry to the fetch step
fix: resolve fallback font detection on variable fonts
docs: update README for v2 scope
```

Types: `feat`, `fix`, `chore`, `refactor`, `docs`.

## Pull requests

Keep changes focused — one concern per PR. Describe what changed and how you
checked it. PRs are squash merged, so the PR title must be a conventional commit.
