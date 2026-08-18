---
name: only-cli
description: Browse websites from the terminal in a few hundred tokens. Use when you need content from a web page, want to check a link, or would otherwise fetch raw HTML or reach for a browser.
---

# only-cli

Turns a web page into a compact terminal view instead of a raw HTML dump. A typical page renders in under 500 tokens.

No install needed, run it with npx:

```
npx @only-cli/oc open <url>     compact view with numbered elements
npx @only-cli/oc raw <url>      whole page as markdown (add --html for cleaned HTML)
```

## Reading the output

- The first line is the page title, then headings, text, and interactive elements in page order.
- `[n]` marks a link, button, or input.
- The `actions:` line at the bottom lists valid next commands.
- `... N more blocks over budget` means content was cut to stay cheap. Rerun with `--budget 1500` if you need more, or use `raw` for everything.

## Following links (current version)

`do <n>` and the other action commands land in v0.2. Until then: run `raw <url>` to see each link's href in markdown form, then `open` that URL directly.

## Flags

- `--budget <tokens>` raise or lower the render budget (default 500)
- `--json` machine-stable JSON of the distilled page
- `--html` with raw: cleaned HTML instead of markdown, if markup suits your task better
- `--verbose` (`-v`, alias `--stats`) metrics on stderr: tokens saved vs the page HTML, HTTP status and which client identity got the page, fetch and processing time, bytes transferred, memory use. Only pass this when you are running in verbose mode or diagnosing a problem; the metrics line costs tokens like everything else. Users can export `OC_VERBOSE=1` to turn it on globally.

## When not to use it

Pages that require login or heavy client-side JavaScript are not supported yet. If a page comes back empty or blocked, say so and fall back to another method rather than retrying.
