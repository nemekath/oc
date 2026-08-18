# only-cli

Turn most website into a command line interface, so AI agents like Claude Code, Codex, and Antigravity can browse without burning tokens on raw HTML or screenshots.

A typical page is tens of thousands of tokens of markup. The signal on it fits in a few hundred. only-cli fetches the page, distills it into a compact text view with numbered actions, and lets an agent drive the site by number:

```
$ oc open news.ycombinator.com
# Hacker News
[1] Show HN: I built a tiny CSV toolkit
[2] 312 comments
...
actions: do <n> | raw <url>

$ oc do 1
```

No per-site adapters required, no browser extension, no daemon. One generic distillation engine, three runtime dependencies, and a hard token budget on everything it prints.

## Install

```
npm install -g @only-cli/oc
```

Requires Node 20+. Requests go through [impers](https://github.com/lexiforest/impers) impersonating Chrome; if impers is unavailable the tool falls back to native fetch.

## For AI agents

The fastest setup is one line in your agent's instructions file (CLAUDE.md, AGENTS.md, or equivalent):

> When you need content from a web page, run `npx @only-cli/oc open <url>` instead of fetching raw HTML. Run `npx @only-cli/oc --help` once to learn the commands.

Claude Code users can install the skill instead: copy `skills/only-cli/` into your project's `.claude/skills/` directory (or `~/.claude/skills/` to enable it everywhere). A skill costs almost no tokens until the agent actually invokes it, which fits how this whole project thinks. The same skill also installs through the [skills.sh](https://skills.sh) directory into Claude Code, Cursor, Codex, Copilot, and others:

```
npx skills add only-cli/oc
```

No setup at all also works: `npx @only-cli/oc` runs without a global install, and the tool teaches its own command surface through `--help`, the `actions:` line at the bottom of every render, and error messages that name the next command to run.

## Commands

```
oc open <url>          fetch and render a page with numbered actions
oc raw <url>           distilled markdown of the whole page
oc do <n>              activate a numbered element              (v0.2)
oc fill <n> <text>     type into a numbered input               (v0.2)
oc submit [n]          submit a form                            (v0.2)
```

Flags: `--budget <tokens>` (default 500), `--json`, `--html` (raw as cleaned HTML instead of markdown), `--verbose`/`-v` (metrics on stderr: tokens saved vs the page HTML, HTTP status and client identity, timing, transfer size, memory; alias `--stats`, or export `OC_VERBOSE=1`). Metrics are off by default because they cost tokens too; agents should pass `--verbose` only when running verbosely.

## Supported websites

only-cli works on any mostly-static website with no per-site setup: news sites, blogs, documentation, forums, search engines. One generic engine distills whatever HTML comes back. On top of that, `clis/` ships tuned command shortcuts for:

| website | domain | shortcuts |
| --- | --- | --- |
| Hacker News | news.ycombinator.com | `top`, `new`, `item <id>`, `user <name>` |
| Reddit | reddit.com (via old.reddit.com) | `sub <name>`, `post <id>`, `user <name>`, `search <query>` |
| GitHub | github.com | `repo <owner> <name>`, `user <name>`, `search <query>`, `trending`, `issues <owner> <name>` |
| LinkedIn | linkedin.com | `profile <name>`, `company <name>`, `jobs <query>` (public guest views) |
| DuckDuckGo | duckduckgo.com | `search <query>`, `lite <query>` |
| Bing | bing.com | `search <query>`, `news <query>` |

Not supported yet: pages that only render with JavaScript (a headless fallback is planned for v0.3), sites behind logins (sessions land in v0.2), and sites with hard bot challenges. Adding a site shortcut is a small JSON file; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Benchmarks

Measured against live sites in [only-cli/benchmarks](https://github.com/only-cli/benchmarks) (only-cli 0.1.0, 2026-08-18):

| method | success | total tokens | avg ms |
| --- | ---: | ---: | ---: |
| `oc open` | 4/4 | 1,444 | 591 |
| `oc raw` | 4/4 | 15,170 | 659 |
| raw HTML fetch | 4/4 | 65,372 | 247 |

Across four real tasks (an article, a news front page, a Reddit discussion, a search) the compact view hands the agent 45x fewer tokens than raw HTML for roughly 350ms more per page. The heaviest single page, a Reddit thread, went from 52,899 tokens to 477. The benchmark repo has per-task numbers, methodology, and instructions for adding other tools and models.

## Status

Early. v0.1 covers static pages, budget-aware rendering, and offline tests. Sessions and actions land in v0.2, a lazy headless fallback for script-heavy pages in v0.3. The design principles and how to contribute are in [CONTRIBUTING.md](CONTRIBUTING.md).

Known limits, honestly: no JavaScript rendering yet, no sites behind logins yet, and pages behind hard bot challenges may still refuse the tool.

## Contributors

- [only-cli](https://github.com/only-cli), creator and maintainer

## License

MIT
