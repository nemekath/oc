/**
 * Sessions are plain JSON files on disk, one per name: current URL, cookies,
 * the last distilled page so actions can resolve handles, and history. No
 * daemon, no background process. Read/write lands in v0.2 with act.js.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

export const SESSION_DIR = join(homedir(), '.only-cli', 'sessions');

/**
 * @param {string} name
 * @returns {string}
 */
export const sessionPath = (name) => join(SESSION_DIR, `${name}.json`);
