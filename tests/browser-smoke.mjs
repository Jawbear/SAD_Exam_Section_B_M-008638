import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { demoAccounts } from './support/demo-config.mjs';

const base = process.env.BROWSER_BASE_URL || 'http://127.0.0.1:5173/';
const browserPath = process.env.BROWSER_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(existsSync);
assert.ok(browserPath, 'Set BROWSER_PATH to a Chrome, Chromium, or Edge executable.');
const [staff, scholar] = demoAccounts();
await mkdir(resolve('.cache'), { recursive: true });
const profile = await mkdtemp(resolve('.cache/scholarship-live-browser-'));
const chrome = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking',
  `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
], { windowsHide: true, stdio: 'ignore' });

async function waitFor(check, description) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause(200);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

let socket;
let commandId = 0;
const pending = new Map();
const browserErrors = [];

async function cdp(method, params = {}) {
  const id = ++commandId;
  return new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Chrome did not respond to ${method}.`));
    }, 5000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(`Chrome failed to run ${method}.`));
      else resolveResult(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const evaluation = await cdp('Runtime.evaluate', { expression, returnByValue: true });
  if (evaluation.exceptionDetails) throw new Error('A browser interaction failed.');
  return evaluation.result.value;
}

async function heading(title) {
  await waitFor(async () => {
    const current = await evaluate("document.querySelector('main h1')?.textContent");
    if (['Could not open this view', 'Could not load your account', 'Account setup required'].includes(current)) {
      throw new Error(`${current}. ${await evaluate("document.querySelector('main [role=alert]')?.textContent ?? ''")}`);
    }
    return current === title;
  }, title);
}

async function signIn({ email, password }, dashboard) {
  await waitFor(() => evaluate("!!document.querySelector('#login-form fieldset:not([disabled])')"), 'the enabled sign-in form');
  await evaluate(`(() => {
    const form = document.querySelector('#login-form');
    form.elements.login_email.value = ${JSON.stringify(email)};
    form.elements.login_password.value = ${JSON.stringify(password)};
    form.requestSubmit();
  })()`);
  await heading(dashboard);
}

const text = async (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`);
const exists = async (selector) => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
const click = async (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function input(selector, value) {
  await evaluate(`(() => {
    const control = document.querySelector(${JSON.stringify(selector)});
    control.value = ${JSON.stringify(value)};
    control.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function viewport(width, height) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate('window.innerWidth'), width);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, `Horizontal page overflow at ${width}px`);
}

async function screenshot(name) {
  if (!process.env.BROWSER_CAPTURE) return;
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(`.cache/scholarship-${name}.png`), Buffer.from(data, 'base64'));
}

async function visit(route, title) {
  if (await evaluate('window.innerWidth <= 860')) {
    await click('#menu-toggle');
    await waitFor(() => exists('#mobile-navigation[open]'), 'the mobile navigation drawer');
    await click(`#mobile-navigation [data-route="${route}"]`);
    assert.equal(await exists('#mobile-navigation[open]'), false);
  } else {
    await click(`#site-sidebar [data-route="${route}"]`);
  }
  await heading(title);
}

async function reload() {
  const previous = await evaluate('performance.timeOrigin');
  await cdp('Page.reload');
  await waitFor(async () => (await evaluate('performance.timeOrigin')) !== previous, 'the refreshed page');
}

async function signOut() {
  await click('summary[aria-label^="Account menu"]');
  await click('#site-header [data-logout]');
  await waitFor(() => exists('#login-form'), 'the sign-in form after sign-out');
}

try {
  let port;
  await waitFor(async () => {
    const info = await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8').catch(() => '');
    port = info.trim().split(/\r?\n/)[0];
    return Boolean(port);
  }, 'headless Chrome');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const tab = tabs.find((target) => target.type === 'page');
  assert.ok(tab, 'Chrome did not open a tab.');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  socket.addEventListener('message', ({ data }) => {
    const reply = JSON.parse(data);
    if (reply.method === 'Runtime.exceptionThrown') browserErrors.push(reply.params.exceptionDetails.text);
    if (reply.method === 'Runtime.consoleAPICalled' && reply.params.type === 'error') browserErrors.push('Application console error');
    if (reply.method === 'Log.entryAdded' && reply.params.entry.level === 'error') browserErrors.push(reply.params.entry.text);
    const resolveReply = pending.get(reply.id);
    if (resolveReply) {
      pending.delete(reply.id);
      resolveReply(reply);
    }
  });
  await waitFor(() => socket.readyState === WebSocket.OPEN, 'the Chrome debugging connection');
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await viewport(1440, 920);
  await cdp('Page.navigate', { url: base });
  await waitFor(() => exists('#login-form'), 'the sign-in form');
  await waitFor(() => evaluate("Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0)"), 'login image assets');
  await screenshot('login-desktop');
  await click('#password-toggle');
  assert.equal(await exists('#login_password[type=text]'), true);
  await click('#password-toggle');
  assert.equal(await exists('#login_password[type=password]'), true);
  await click('#login-form button[type=submit]');
  assert.match(await text('#login_email-error'), /valid email/);
  assert.match(await text('#login_password-error'), /password/);

  await signIn(staff, 'Staff dashboard');
  assert.equal(await evaluate("document.querySelectorAll('.metric-grid .metric').length"), 4);
  assert.match(await text('#roster-records'), /B01[\s\S]+B06/);
  await screenshot('staff-desktop');
  await click('[data-search]');
  assert.equal(await evaluate('document.activeElement.id'), 'roster_search');
  await input('#term_semester', '2');
  await click('#term-form button[type=submit]');
  await waitFor(async () => /Semester 2/.test(await text('.term-label')), 'the second semester roster');
  assert.match(await evaluate('location.hash'), /semester=2/);
  await input('#term_semester', '1');
  await click('#term-form button[type=submit]');
  await waitFor(async () => /Semester 1/.test(await text('.term-label')), 'the first semester roster');
  await input('#roster_search', 'Avery');
  assert.match(await text('#roster-count'), /^1 of /);
  await input('#roster_search', 'b01');
  assert.match(await text('#roster-count'), /^1 of /);
  await input('#compliance_filter', 'no_submission');
  assert.match(await text('#roster-records'), /No scholars match/);
  await click('#clear-filters');
  const accessProgram = await evaluate("Array.from(document.querySelector('#program_filter').options).find((option) => option.text.includes('Access Scholar')).value");
  await input('#program_filter', accessProgram);
  assert.match(await text('#roster-records'), /Access Scholar/);
  assert.doesNotMatch(await text('#roster-records'), /Excellence Scholar/);
  await click('#clear-filters');
  const row = "Array.from(document.querySelectorAll('tbody tr')).find((row) => row.textContent.includes('Avery Cruz'))";
  assert.equal(await evaluate(`Boolean(${row})`), true);
  await evaluate(`${row}.querySelector('[data-route="staff-review"]').click()`);
  await heading('Review submission');
  assert.match(await text('main'), /Avery Cruz[\s\S]+DEMO-GRADE-B01/);
  assert.match(await text('#review-compliance'), /Policy requirement/);
  if (await exists('#evaluate-form')) {
    await click('#evaluate-form button[type=submit]');
    assert.match(await text('#action-dialog'), /Record the compliance evaluation/);
    await click('#action-dialog button[value=cancel]');
    await waitFor(() => exists('#evaluate-form button:not([disabled])'), 'the restored evaluation action');
  }
  await click('[data-jump="review-history"]');
  assert.equal(await evaluate('document.activeElement.id'), 'review-history');
  await reload();
  await heading('Review submission');
  assert.match(await text('main'), /DEMO-GRADE-B01/);
  const reviewPath = await evaluate('location.hash');
  await click('.skip-link');
  assert.equal(await evaluate('location.hash'), reviewPath);
  assert.equal(await evaluate('document.activeElement.id'), 'main-content');
  await visit('staff-verification', 'Verification');
  await waitFor(() => exists('#roster-records [data-route=staff-review]'), 'the pending verification record');
  await click('#roster-records [data-route=staff-review]');
  await heading('Review submission');
  assert.equal(await exists('#review-compliance button:disabled'), true);
  await click('#verify-evidence-form button');
  assert.match(await text('#action-dialog'), /Verify this evidence/);
  await click('#action-dialog button[value=cancel]');
  await waitFor(() => exists('#verify-evidence-form button:not([disabled])'), 'the restored verify action');
  await click('.return-details summary');
  await click('#return-evidence-form button[type=submit]');
  assert.match(await text('#return_reason-error'), /reason/);
  await input('#return_reason', 'Browser cancellation check');
  await click('#return-evidence-form button[type=submit]');
  assert.match(await text('#action-dialog'), /Return this submission/);
  await click('#action-dialog button[value=cancel]');
  await waitFor(() => exists('#return-evidence-form button:not([disabled])'), 'the restored return action');
  await click('#site-sidebar [data-route=staff-compliance]');
  assert.match(await text('#action-dialog'), /Discard unsaved changes/);
  await click('#dialog-confirm');
  await heading('Compliance');
  await visit('staff-renewal', 'Renewal decisions');
  await visit('staff-reports', 'Reports & history');
  await visit('staff-programs', 'Scholarship programs');
  assert.match(await text('main'), /Access Scholar[\s\S]+Excellence Scholar/);
  await visit('staff-submissions', 'Submissions');
  await visit('staff-directory', 'Scholar directory');
  await input('#directory_search', 'B01');
  await click('#clear-directory');
  assert.equal(await evaluate("document.querySelector('#directory_search').value"), '');
  await input('#directory_search', 'B01');
  await click('#directory-records [data-route=staff-scholar]');
  await heading('Avery Cruz');
  assert.match(await text('main'), /Excellence Scholar/);
  await click('#assignment-form button[type=submit]');
  assert.match(await text('#program-error'), /Select a scholarship program/);
  await visit('staff-directory', 'Scholar directory');
  await click('main [data-route=staff-register]');
  await heading('Register scholar');
  await click('#register-form button[type=submit]');
  assert.match(await text('#full_name-error'), /scholar/);
  await viewport(820, 1020);
  await visit('staff-home', 'Staff dashboard');
  await viewport(820, 1020);
  await screenshot('staff-tablet');
  await visit('staff-profile', 'Profile');
  assert.match(await text('main'), /Scholarship Staff/);
  console.log('Staff audit passed for desktop and tablet navigation, filters, a persisted review, forms, and confirmation handling.');
  await signOut();

  await viewport(390, 844);
  await signIn(scholar, 'Welcome, Avery Cruz');
  await viewport(390, 844);
  await screenshot('scholar-mobile');
  assert.match(await text('main'), /Excellence Scholar/);
  await click('main [data-route=scholar-record]');
  await heading('Semester submission');
  const record = await text('main');
  assert.match(record, /DEMO-GRADE-B01/);
  assert.match(record, /Verified/);
  assert.match(record, /Review outcome/);
  assert.equal(await exists('[data-route=staff-directory]'), false);
  await cdp('Page.navigate', { url: new URL('#staff-home', base).href });
  await waitFor(async () => (await evaluate('location.hash')) === '#scholar-home', 'the role-guarded route');
  await heading('Welcome, Avery Cruz');
  await visit('scholar-history', 'History');
  await visit('scholar-programs', 'Scholarship programs');
  assert.doesNotMatch(await text('main'), /Access Scholar/);
  await visit('scholar-submissions', 'Submissions');
  await click('main [data-route=scholar-submit]');
  await heading('Submit semester grades');
  await viewport(390, 844);
  await click('#academic-form button[type=submit]');
  assert.match(await text('#semester-error'), /already have a submission/);
  assert.match(await text('#gwa-error'), /from 1.00 to 5.00/);
  await input('#semester', '2');
  await input('#gwa', '2.00');
  await input('#units', '18');
  await input('#evidence', 'Browser cancellation check');
  await click('#academic-form button[type=submit]');
  assert.match(await text('#action-dialog'), /Submit semester grades/);
  await click('#action-dialog button[value=cancel]');
  await waitFor(() => exists('#academic-form button[type=submit]:not([disabled])'), 'the restored submit action');
  await click('#menu-toggle');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor(async () => !await exists('#mobile-navigation[open]'), 'the drawer to close with Escape');
  await click('#menu-toggle');
  await click('#mobile-navigation [data-route=scholar-home]');
  assert.match(await text('#action-dialog'), /Discard unsaved changes/);
  await click('#dialog-confirm');
  await heading('Welcome, Avery Cruz');
  await visit('scholar-profile', 'Profile');
  assert.match(await text('main'), /B01/);
  console.log('Scholar audit passed for mobile navigation, review status, inline validation, and keyboard dismissal.');
  await signOut();
  assert.deepEqual(browserErrors, [], 'Unexpected errors were reported by Chrome.');
} finally {
  socket?.close();
  chrome.kill();
}
