# Contributing to kolophon

Issues and pull requests are welcome.

## Setup

Requires Node 20+ and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev          # launch Chrome with the extension loaded
pnpm compile      # typecheck — run before every PR
pnpm --filter @kolophon/mcp test   # MCP server tests (needs Chrome installed)
```

## Branches

v2 work happens on the `v2` branch. Branch features off `v2`, not `main`, and
open PRs against `v2`. Nothing merges to `main` until a phase is stable.

## Commits

[Conventional commits](https://www.conventionalcommits.org), one-line subject,
present tense, under 72 characters:

```
feat: add get_typography MCP tool
fix: resolve fallback font detection on variable fonts
docs: update README for v2 scope
```

Types: `feat`, `fix`, `chore`, `refactor`, `docs`.

## Pull requests

Keep changes focused — one concern per PR. Describe what changed and how you
checked it.

## Releases

Releases are tagged on `main` after each phase ships (`v2.0.0`, `v2.1.0`), with
a short changelog in GitHub Releases. The version lives in `package.json` only;
the extension manifest reads it from there.
