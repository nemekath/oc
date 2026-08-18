/**
 * Actions against a saved session: do, read, and next now, fill, submit, find,
 * and back still ahead. Errors here are read by agents, so every one of them
 * names the command to run next.
 *
 * Nothing in this file touches the network. The page an agent is working on is
 * already on disk from the last `oc open`, so continuing to read it costs one
 * file read and whatever tokens the caller asked for.
 */

import { DEFAULT_SESSION, handleFor, handleNumbers, loadSession, saveSession } from './session.js';
import { estimateTokens, formatBlock, render } from './render.js';

export class NotImplemented extends Error {
  constructor(command) {
    super(`'oc ${command}' is not available yet. Until then use 'oc open' and 'oc raw'.`);
  }
}

/**
 * @param {string} session
 * @returns {any}
 */
function requireSession(session) {
  const state = loadSession(session);
  if (!state) {
    throw new Error("nothing open in this session yet, run 'oc open <url>' first");
  }
  return state;
}

/**
 * `read` and `next` work from the saved blocks, which older sessions do not
 * have. One `oc open` fixes it, so say that instead of failing blankly.
 * @param {string} session
 */
function requireBlocks(session) {
  const state = requireSession(session);
  if (!Array.isArray(state.blocks)) {
    throw new Error(`this session was saved by an older oc, run 'oc open ${state.url}' again`);
  }
  return state;
}

/**
 * Resolve a numbered handle from the last render into something to open.
 * Returns the target URL; the caller fetches and renders it exactly as
 * `oc open` would, so `do` and `open` always agree on what a page looks like.
 * @param {number} n
 * @param {{session?: string}} [opts]
 * @returns {{url: string, text: string}}
 */
export function activate(n, { session = DEFAULT_SESSION } = {}) {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('usage: oc do <n>, where <n> is a number from the last page');
  }
  const state = requireSession(session);
  const handle = handleFor(state, n);
  if (!handle) {
    const nums = handleNumbers(state);
    const range = nums.length ? `1-${Math.max(...nums)}` : 'none';
    throw new Error(`no [${n}] on ${state.url} (handles ${range}), run 'oc open <url>' again to renumber`);
  }
  if (handle.type === 'text' || handle.type === 'heading') {
    throw new Error(`[${n}] is ${handle.type}, not a link, use 'oc read ${n}' for the full text there`);
  }
  if (handle.type === 'input') {
    throw new Error(`[${n}] is an input (${handle.name ?? 'text'}), typing needs 'oc fill', which is not available yet`);
  }
  if (handle.type === 'button' || !handle.href) {
    throw new Error(`[${n}] has no link to follow, it is a ${handle.type} the page handles itself`);
  }
  return { url: handle.href, text: handle.text };
}

// How many blocks of run-up `read` prints before the one it was asked for, so
// a comment or paragraph arrives with the byline that introduces it, and how
// many it prints after. The trailing window only applies when the target is
// not a heading: a heading owns its whole section, anything else is one thing
// the agent asked to see in full and a little of what follows it.
const LEAD = 2;
const TRAIL = 6;

/**
 * Full text of one region of the current page: the block at [n], the couple of
 * blocks that lead into it, and either the rest of its section when [n] is a
 * heading or a short run after it when it is not. This is the middle setting
 * between the 500 token view and the whole page.
 * @param {number} n
 * @param {{session?: string, budget?: number}} [opts]
 * @returns {string}
 */
export function read(n, { session = DEFAULT_SESSION, budget = 2000 } = {}) {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('usage: oc read <n>, where <n> is a number from the last page');
  }
  const state = requireBlocks(session);
  const blocks = state.blocks;
  const at = blocks.findIndex((b) => b.n === n);
  if (at < 0) {
    const nums = handleNumbers(state);
    const range = nums.length ? `1-${Math.max(...nums)}` : 'none';
    throw new Error(`no [${n}] on ${state.url} (handles ${range}), run 'oc open <url>' again to renumber`);
  }

  const isHeading = blocks[at].type === 'heading';
  let start = isHeading ? at : Math.max(0, at - LEAD);
  // Never open with the tail of the section before this one.
  for (let i = at - 1; i > start; i--) {
    if (blocks[i].type === 'heading') {
      start = i;
      break;
    }
  }
  // A heading owns everything down to the next heading of its level or above;
  // anything else runs to the next heading of any level.
  const stopLevel = blocks[start].type === 'heading' ? (blocks[start].level ?? 2) : 6;
  const end = isHeading ? blocks.length : Math.min(blocks.length, at + TRAIL + 1);

  const lines = [];
  let spent = 0;
  let i = start;
  for (; i < end; i++) {
    const block = blocks[i];
    if (i > start && block.type === 'heading' && (block.level ?? 2) <= stopLevel) break;
    const line = formatBlock(block, { full: true });
    if (!line) continue;
    const cost = estimateTokens(line) + 1;
    if (spent + cost > budget && lines.length) break;
    spent += cost;
    lines.push(line);
  }

  const stoppedEarly = i < end && !(blocks[i].type === 'heading' && (blocks[i].level ?? 2) <= stopLevel);
  if (stoppedEarly) {
    const resume = blocks.slice(i).find((b) => b.n != null)?.n;
    const how = resume ? `continue with 'oc read ${resume}'` : "use 'oc raw' for the rest";
    lines.push(`... region cut at ~${budget} tokens, ${how} or raise --budget`);
  }
  return lines.join('\n');
}

/**
 * The next budget worth of the page the session already holds. `oc open` says
 * how many blocks it left behind; this is how an agent takes them a screenful
 * at a time instead of paying for the whole page to get one more paragraph.
 * @param {{session?: string, budget?: number}} [opts]
 * @returns {string}
 */
export function next({ session = DEFAULT_SESSION, budget = 500 } = {}) {
  const state = requireBlocks(session);
  const from = state.cursor;
  if (from == null) {
    return `end of ${state.url}, nothing left to render. 'oc open <url>' to reload it, 'oc raw' for the whole page.`;
  }
  const page = { url: state.url, title: state.title, blocks: state.blocks };
  const { text, stats } = render(page, { budget, from });
  try {
    saveSession(session, { ...state, cursor: stats.next });
  } catch {}
  return text;
}

/** @param {number} n @param {string} text */
export function fill(n, text) {
  throw new NotImplemented('fill');
}

/** @param {number} [n] */
export function submit(n) {
  throw new NotImplemented('submit');
}

/** @param {string} query */
export function find(query) {
  throw new NotImplemented('find');
}

export function back() {
  throw new NotImplemented('back');
}
