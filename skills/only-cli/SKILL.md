---
name: only-cli
description: Browse websites from the terminal in a few hundred tokens. Use when you need content from a web page, want to check a link, or would otherwise fetch raw HTML or reach for a browser.
---

# only-cli

Turns a web page into a compact terminal view instead of a raw HTML dump. A typical page renders in under 500 tokens.

No install needed, run it with npx:

```
npx @only-cli/oc open <url>     compact view with numbered elements
npx @only-cli/oc do <n>         follow numbered link [n] from the last page
npx @only-cli/oc find <query>   where a string appears on the page already open
npx @only-cli/oc next           the next ~500 tokens of the page already open
npx @only-cli/oc read <n>       full text of the region at [n]
npx @only-cli/oc raw [url]      whole page as markdown (add --html for cleaned HTML)
```

## Reading the output

- The first line is the page title, then headings, text, and interactive elements in page order.
- `[n]` marks a link, button, input, heading, or a text block long enough to be cut.
- `... +820 chars` at the end of a line means that block was cut there. `read <n>` prints it whole.
- `... 164 more blocks (~7,100 tokens)` means the page ran past the budget. That is the price of the rest, so you can decide before paying.
- The `actions:` line at the bottom lists valid next commands.

## Reading more of a page

Four ways to go past the first view, cheapest first. Pick by what you need, not by habit.

- `oc find <query>` prints every place a string appears on the page, one line each with the number to read it by. When you know what you are looking for, this is the whole job in one command.
- `oc read <n>` prints one region in full: the block at `[n]` with a little context, or the whole section when `[n]` is a heading. Use it when the view or a `find` hit shows you exactly the block you want.
- `oc next` prints the next budget worth of the same page and remembers where it stopped, so calling it again continues. Use it when you are reading rather than looking something up.
- `oc raw` (no URL needed once a page is open) prints everything. It costs an order of magnitude more, so use it when you genuinely need the whole page.

Measured on one Reddit thread: `open` 475 tokens, one `find` 115, one `read` 88, each `next` about 455, `raw` 9,670. None of them fetches anything; they all work from the page `open` already saved.

```
oc open https://old.reddit.com/r/linuxquestions/comments/xpznb1/best_terminal_web_browser/
oc find w3m                     -> 7 matches with their numbers, 115 tokens
oc read 245                     -> that comment in full, 88 tokens
oc next                         -> keep reading, 455 tokens at a time
```

`find` matches the query as a phrase, case insensitive, and falls back to matching the words separately when the phrase is not there. It says how many matches it held back if they did not fit the budget.

## Following links

Use `do <n>`. The compact view leaves link URLs out because they cost tokens and you do not need them, so to open `[15] 41 comments` run `oc do 15`. It renders the new page exactly like `open` does, and the numbers then refer to that new page.

```
oc open news.ycombinator.com    ->  [15] 41 comments
oc do 15                        ->  the comment thread, renumbered
```

Notes that save a round trip:

- Numbers come from the most recent render, so re-read the newest output before choosing one. Any command that renders a page renumbers.
- Handles hidden behind a `[6-9] 4 similar links` marker still work, even though their text was collapsed.
- Search result links resolve to the destination, not the search engine's tracking redirect.
- `do` on an input or a button says so; typing and submitting are not available yet.
- `do` on a heading or a text block says to use `read <n>` instead.
- `--session <name>` keeps separate page state, for working on two sites at once.

Reach for `raw <url>` when you need the whole page text, not to hunt for a URL.

## Flags

- `--budget <tokens>` raise or lower the render budget (default 500, 2000 for `read`)
- `--json` machine-stable JSON of the distilled page
- `--html` with raw: cleaned HTML instead of markdown, if markup suits your task better
- `--verbose` (`-v`, alias `--stats`) metrics on stderr: tokens saved vs the page HTML, HTTP status and which client identity got the page, fetch and processing time, bytes transferred, memory use. Only pass this when you are running in verbose mode or diagnosing a problem; the metrics line costs tokens like everything else. Users can export `OC_VERBOSE=1` to turn it on globally.

## When not to use it

Pages that require login or heavy client-side JavaScript are not supported yet. If a page comes back empty or blocked, say so and fall back to another method rather than retrying.
