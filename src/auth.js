/**
 * Detect when a fetched page is a login gate rather than the content the
 * caller expected. Runs before contentFailure so a thin login form is not
 * partially rendered as if it were real content.
 */

const LOGIN_PATH = /\/(?:login|signin|sign-in|auth|oauth|sso)(?:\/|$|\?)/i;
const LOGIN_TITLE = /\b(?:log\s*in|sign\s*in|authenticate)\b/i;
const LOGIN_BUTTON = /\b(?:log\s*in|sign\s*in|continue|submit)\b/i;

/**
 * @param {string} url
 * @returns {string}
 */
export function sessionExpiredMessage(url) {
  return `session expired or cookies are no longer valid for ${url}`;
}

/**
 * @param {import('./distill.js').Page} page
 * @param {string} url
 * @param {{ hadAuth?: boolean }} [opts]
 * @returns {string|null}
 */
export function authFailure(page, url, { hadAuth = false } = {}) {
  const hasPassword = page.blocks.some((b) => b.type === 'input' && b.text === 'password');
  if (!hasPassword) return null;

  let pathname = '';
  try {
    pathname = new URL(url).pathname;
  } catch {
    // malformed URL: rely on other signals only
  }

  const loginUrl = LOGIN_PATH.test(pathname);
  const loginTitle = LOGIN_TITLE.test(page.title ?? '');
  const loginButton = page.blocks.some((b) =>
    (b.type === 'button' || b.type === 'input') && LOGIN_BUTTON.test(b.text ?? ''),
  );

  if (!loginUrl && !loginTitle && !loginButton) return null;

  if (hadAuth) return sessionExpiredMessage(url);
  return 'this page requires login; run \'oc login --cookie "..." --domain example.com\'';
}
