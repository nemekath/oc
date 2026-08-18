/**
 * Actions against a live session: do, fill, submit, read, find, back, next.
 * All of this ships in v0.2 together with session state (see PROMPT.md
 * milestones). The signatures exist now so cli.js wires up once and the
 * command surface stays stable.
 */

export class NotImplemented extends Error {
  constructor(command) {
    super(`'oc ${command}' lands in v0.2, see PROMPT.md milestones. Until then use 'oc open' and 'oc raw'.`);
  }
}

/** @param {number} n */
export function activate(n) {
  throw new NotImplemented('do');
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
