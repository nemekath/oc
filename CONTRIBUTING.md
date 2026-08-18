# Contributing to only-cli

Thanks for wanting to help. This is a small project with strong opinions, so this guide is short but strict. Read [PROMPT.md](PROMPT.md) before anything else: it holds the design principles, the pipeline, and the roadmap, and every PR is judged against it.

## Setup

```
git clone https://github.com/only-cli/oc
cd oc
npm install
npm test
```

Node 20+. Tests run fully offline against saved fixtures in `tests/pages/`, so a plane is a fine place to work on this.

## What makes a PR easy to accept

- **It respects the token budget.** Everything this tool prints gets read by a paying model. If your change adds output, show the before and after of `--stats` on a fixture page. A default render that crosses 500 tokens needs a very good reason; past 2,000 it is a bug.
- **It adds no dependencies.** The runtime dependency count (three) is a feature. If you truly need a new one, justify it in one line in the PR description and expect the default answer to be no. Standard library first, always.
- **It keeps output deterministic.** Same page, same command, same output. There is a test for this; do not weaken it.
- **It comes with an offline test.** New behavior gets a fixture in `tests/pages/` and a test in `tests/`. No network calls in tests, ever.
- **It fails loud and cheap.** A feature that cannot handle a page should say so in one line and exit nonzero, never dump raw HTML as a fallback.

## Code style

Plain JavaScript, ESM, JSDoc types, no build step. Match the code around you. Comments explain constraints and trade-offs, not what the next line does; if a comment restates the code, delete it. Small functions, few files: if you are adding a new file to `src/`, pause and check whether the logic belongs in one of the six that exist.

## Writing style

All prose in this repo (docs, comments, commit messages, error text, CLI help) follows the rules in PROMPT.md: write like a human, be precise like a developer, and leave a trail like a contributor. Be honest about limitations. Do not use em dashes anywhere; use commas, colons, or separate sentences.

Commit messages explain why, not just what. "Cap link text at 200 chars, long titles were eating half the budget" tells the next person everything.

## Adding a site definition

Per-site CLIs live in `clis/`, one JSON file per domain, following the spec format section in PROMPT.md. Keep it under 50 lines. If the site has a public JSON API, point the commands at that instead of the HTML pages. If your definition needs logic, it is trying to become an adapter, and the answer is to improve the generic engine instead.

## Reporting bugs

Open an issue with the exact command, the output you got, and the output you expected. If the page is public, include the URL. If distillation mangled a page, a saved copy of the HTML as a fixture is the most useful thing you can attach.

## Releasing (maintainer)

Publishing a GitHub release runs `.github/workflows/publish.yml`, which tests and publishes to npm through OIDC trusted publishing: no npm token stored anywhere, no one-time password, and npm attaches provenance automatically. The trusted publisher link (npm package settings, GitHub Actions, repo `only-cli/oc`, workflow `publish.yml`) has to be configured once on npmjs.com after the first manual publish, since npm only lets you attach a trusted publisher to a package that already exists.

## Maintainer

[only-cli](https://github.com/only-cli)
