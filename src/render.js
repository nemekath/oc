/**
 * Rendering is where the token budget is enforced. Everything printed here
 * gets read by a paying model, so the default view is dense and anything
 * skipped says so in one line.
 */

const TEXT_CAP = 200;

/**
 * Rough but stable token estimate. Close enough for budgets; the point is
 * that it never changes between runs, not that it matches any one tokenizer.
 * @param {string} s
 * @returns {number}
 */
export const estimateTokens = (s) => Math.ceil(s.length / 4);

/**
 * Budget-aware compact view of a distilled page.
 * @param {import('./distill.js').Page} page
 * @param {{budget?: number}} [opts]
 * @returns {{text: string, stats: {tokens: number, blocks: number, rendered: number}}}
 */
export function render(page, { budget = 500 } = {}) {
  const lines = page.title ? [`# ${page.title}`] : [];
  let spent = estimateTokens(lines.join('\n'));
  let skipped = 0;
  let hasLinks = false;
  let hasInputs = false;

  for (const block of collapseRuns(page.blocks)) {
    // Never print the same content twice. Pages often repeat the title as
    // their first heading.
    if (block.type === 'heading' && block.text === page.title) continue;
    const line = formatBlock(block);
    if (!line) continue;
    const cost = estimateTokens(line) + 1;
    if (spent + cost > budget) {
      skipped++;
      continue;
    }
    spent += cost;
    lines.push(line);
    if (block.type === 'link' || block.type === 'button') hasLinks = true;
    if (block.type === 'input') hasInputs = true;
  }

  if (skipped) lines.push(`... ${skipped} more blocks over budget, raise --budget or use oc raw`);
  const actions = [
    hasLinks && 'do <n>',
    hasInputs && 'fill <n> <text>',
    hasInputs && 'submit',
    'raw <url>',
  ].filter(Boolean);
  lines.push(`actions: ${actions.join(' | ')}`);

  const text = lines.join('\n');
  return {
    text,
    stats: { tokens: estimateTokens(text), blocks: page.blocks.length, rendered: page.blocks.length - skipped },
  };
}

/**
 * Collapse repeated siblings. Long runs of short
 * links are almost always nav chrome (subreddit bars, tag clouds, footers)
 * and would otherwise eat the whole budget before the content starts. Handles
 * are assigned in distill, so the hidden links keep their numbers and the
 * marker names the range.
 * @param {import('./distill.js').Block[]} blocks
 * @returns {import('./distill.js').Block[]}
 */
function collapseRuns(blocks) {
  const SHORT = 20;
  const RUN = 8;
  const KEEP = 5;
  const out = [];
  let i = 0;
  while (i < blocks.length) {
    let j = i;
    while (j < blocks.length && blocks[j].type === 'link' && blocks[j].text.length <= SHORT) j++;
    const run = j - i;
    if (run > RUN) {
      out.push(...blocks.slice(i, i + KEEP));
      const first = blocks[i + KEEP];
      const last = blocks[j - 1];
      out.push({ type: 'text', text: `[${first.n}-${last.n}] ${run - KEEP} similar links, expand with oc raw` });
      i = j;
    } else {
      out.push(blocks[i]);
      i++;
    }
  }
  return out;
}

/**
 * @param {import('./distill.js').Block} b
 * @returns {string}
 */
function formatBlock(b) {
  switch (b.type) {
    case 'heading':
      return `${'#'.repeat(Math.min(b.level ?? 2, 3))} ${b.text}`;
    case 'link':
      return `[${b.n}] ${truncate(b.text)}`;
    case 'button':
      return `[${b.n}] button "${truncate(b.text)}"`;
    case 'input':
      return `[${b.n}] input ${b.name} (${b.text})`;
    default:
      return truncate(b.text);
  }
}

const truncate = (s) => (s.length > TEXT_CAP ? `${s.slice(0, TEXT_CAP)} ...` : s);
