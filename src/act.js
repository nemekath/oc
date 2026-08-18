/**
 * Actions against a saved session: do now, fill, submit, read, find, back,
 * and next still ahead. Errors here are read by agents, so every one of them
 * names the command to run next.
 */

import { DEFAULT_SESSION, loadSession } from './session.js';

export class NotImplemented extends Error {
  constructor(command) {
    super(`'oc ${command}' is not available yet. Until then use 'oc open' and 'oc raw'.`);
  }
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
  const state = loadSession(session);
  if (!state) {
    throw new Error("nothing open in this session yet, run 'oc open <url>' first");
  }
  const handle = state.handles?.[n];
  if (!handle) {
    const nums = Object.keys(state.handles ?? {}).map(Number);
    const range = nums.length ? `1-${Math.max(...nums)}` : 'none';
    throw new Error(`no [${n}] on ${state.url} (handles ${range}), run 'oc open <url>' again to renumber`);
  }
  if (handle.type === 'input') {
    throw new Error(`[${n}] is an input (${handle.name ?? 'text'}), typing needs 'oc fill', which is not available yet`);
  }
  if (handle.type === 'button' || !handle.href) {
    throw new Error(`[${n}] has no link to follow, it is a ${handle.type} the page handles itself`);
  }
  return { url: handle.href, text: handle.text };
}

/** @param {number} n @param {string} text */
export function fill(n, text) {
  throw new NotImplemented('fill');
}

/** @param {number} [n] */
export function submit(n) {
  throw new NotImplemented('submit');
}

/** @param {number} [n] */
export function read(n) {
  throw new NotImplemented('read');
}

/** @param {string} query */
export function find(query) {
  throw new NotImplemented('find');
}

export function back() {
  throw new NotImplemented('back');
}

export function next() {
  throw new NotImplemented('next');
}
