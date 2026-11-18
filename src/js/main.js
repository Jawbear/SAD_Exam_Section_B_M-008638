import { connect, getProfile, read } from '../services/scholarship.js';
import { scholarForm, scholarHistory, scholarHome, scholarRecord, scholarSubmissions } from '../pages/scholar.js';
import { staffDirectory, staffHome, staffRegister, staffReview, staffScholar } from '../pages/staff.js';
import { profilePage, programsPage } from '../pages/account.js';
import { brand, loginPhoto, setFavicon } from '../components/branding.js';
import { icon } from '../components/icons.js';
import {
  confirmAction, escapeHtml as h, field, formAlert, formMessage, hasUnsavedChanges, input,
  message, onForm, setFieldErrors, validateAsYouType,
} from '../components/ui.js';
import { EXAM_TERM, normalizeYear } from '../utils/academic.js';

const root = document.querySelector('#main-content');
const header = document.querySelector('#site-header');
const sidebar = document.querySelector('#site-sidebar');
const shell = document.querySelector('#app-shell');
const drawer = document.querySelector('#mobile-navigation');
const appName = 'Student Scholarship Monitoring and Academic Compliance System';
const routes = {
  'scholar-home': scholarHome, 'scholar-submit': scholarForm,
  'scholar-correct': scholarForm, 'scholar-record': scholarRecord,
  'scholar-submissions': scholarSubmissions, 'scholar-history': scholarHistory,
  'scholar-programs': programsPage, 'scholar-profile': profilePage,
  'staff-home': staffHome, 'staff-directory': staffDirectory,
  'staff-register': staffRegister, 'staff-scholar': staffScholar, 'staff-review': staffReview,
  'staff-submissions': staffHome, 'staff-verification': staffHome, 'staff-compliance': staffHome,
  'staff-renewal': staffHome, 'staff-reports': staffHome, 'staff-programs': programsPage, 'staff-profile': profilePage,
};
const homeRoute = () => `${profile.role}-home`;
const navigation = {
  staff: [
    ['home', 'Dashboard', 'dashboard'], ['directory', 'Scholars', 'users'], ['submissions', 'Submissions', 'file'],
    ['programs', 'Scholarship Programs', 'cap'], ['verification', 'Verification', 'shield'],
    ['compliance', 'Compliance', 'clipboard'], ['renewal', 'Renewal Decisions', 'check'], ['reports', 'Reports & History', 'history'],
  ],
  scholar: [
    ['home', 'Dashboard', 'dashboard'], ['submissions', 'Submissions', 'file'],
    ['programs', 'Scholarship Programs', 'cap'], ['history', 'History', 'history'],
  ],
};
const recordRoutes = new Set(['scholar-correct', 'scholar-record', 'staff-scholar', 'staff-review']);
const validId = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const reviewSections = ['verification', 'compliance', 'renewal', 'history'];
const complianceFilters = ['not_evaluated', 'compliant', 'with_deficiency', 'no_submission'];

let client;
let userId = null;
let profile = null;
let staffTerm = EXAM_TERM;
let viewVersion = 0;
let authVersion = 0;
let endingSession = false;
let currentPath = '';

function titleFor(view, section) {
  const labels = {
    'staff-register': ['directory', 'Register scholar'], 'staff-scholar': ['directory', 'Scholar profile'],
    'staff-review': [section === 'history' ? 'reports' : section || 'submissions', 'Review submission'],
    'scholar-submit': ['submissions', 'Submit grades'], 'scholar-correct': ['submissions', 'Correct submission'],
    'scholar-record': ['submissions', 'Semester submission'],
  };
  const key = view.slice(profile.role.length + 1);
  return labels[view] ?? [key, navigation[profile.role].find(([name]) => name === key)?.[1] ?? 'Profile'];
}

function navButton(key, label, symbol, active) {
  return `<button type="button" class="nav-item" data-route="${profile.role}-${key}"${active === key ? ' aria-current="page"' : ''}>
    ${icon(symbol)}<span>${label}</span></button>`;
}

function renderHeader(view = '', section) {
  shell.dataset.authenticated = String(Boolean(profile));
  sidebar.hidden = !profile;
  header.hidden = !userId;
  if (!profile) {
    sidebar.replaceChildren();
    drawer.replaceChildren();
    header.innerHTML = userId ? `<div class="header-inner">${brand()}
      <button type="button" class="button button--secondary" data-logout>Sign out</button></div>` : '';
    return;
  }
  const [active, label] = titleFor(view, section);
  const role = profile.role === 'staff' ? 'Scholarship Staff' : 'Scholar';
  const initials = profile.full_name.trim().split(/\s+/).slice(0, 2).map((part) => [...part][0]).join('').toUpperCase();
  const links = `<nav class="sidebar-nav" aria-label="Main navigation">
    ${navigation[profile.role].map(([key, name, symbol]) => navButton(key, name, symbol, active)).join('')}
  </nav><div class="sidebar-account">
    ${navButton('profile', 'Profile', 'user', active)}
    <button type="button" class="nav-item" data-logout>${icon('logout')}<span>Sign out</span></button>
  </div>`;
  sidebar.innerHTML = `${brand()}${links}`;
  drawer.innerHTML = `<div class="drawer-heading">${brand()}
    <button type="button" class="icon-button" aria-label="Close navigation" data-close-drawer>${icon('close')}</button></div>${links}`;
  header.innerHTML = `<div class="header-inner">
    <button type="button" class="icon-button menu-toggle" aria-label="Open navigation" aria-haspopup="dialog" aria-controls="mobile-navigation" id="menu-toggle">${icon('menu')}</button>
    <div class="mobile-brand">${brand()}</div>
    <span class="header-title">${h(label)}</span>
    ${profile.role === 'staff' ? `<button type="button" class="icon-button header-search" aria-label="Find a scholar" title="Find a scholar" data-search>${icon('search')}</button>` : ''}
    <details class="account-menu">
      <summary aria-label="Account menu for ${h(profile.full_name)}"><span class="avatar" aria-hidden="true">${h(initials)}</span>
        <span class="account-copy"><strong>${h(profile.full_name)}</strong><small>${role}</small></span>${icon('down')}</summary>
      <div class="account-options">
        ${navButton('profile', 'View profile', 'user', active)}
        <button type="button" class="nav-item" data-logout>${icon('logout')}<span>Sign out</span></button>
      </div>
    </details>
  </div>`;
}

function renderLogin(configurationMessage = '') {
  document.title = `${appName} | Scholarship Office`;
  root.removeAttribute('aria-busy');
  root.classList.add('login-main');
  renderHeader();
  root.innerHTML = `<div class="login-layout">
    <section class="login-intro" aria-labelledby="page-title">
      ${loginPhoto ? `<img class="login-photo" src="${h(loginPhoto)}" alt="University campus building" decoding="async" fetchpriority="high">` : ''}
      <div class="login-brand">${brand()}</div>
      <div class="login-intro-copy">
        <h1 id="page-title" aria-label="${appName}">Student Scholarship <em>Monitoring</em></h1>
        <p>Submit semester grades, track academic compliance, and follow scholarship renewal.</p>
      </div>
      <p class="login-university">Agusan del Sur State University</p>
    </section>
    <section class="login-side" aria-labelledby="login-title"><div class="login-panel">
      <span class="icon-tile login-lock">${icon('lock')}</span>
      <h2 id="login-title">Welcome back</h2>
      <p class="section-note">Sign in with your Scholarship Office account.</p>
      ${configurationMessage ? `<p class="notice notice--error" role="status">${h(configurationMessage)}</p>` : ''}
      <form id="login-form" novalidate>
        <fieldset ${configurationMessage ? 'disabled' : ''}>
          ${field('login_email', 'Email address', input('login_email', '', 'type="email" required autocomplete="username" maxlength="254" placeholder="name@example.edu"'))}
          ${field('login_password', 'Password', `<div class="password-input">
            <input type="password" name="login_password" id="login_password" autocomplete="current-password" aria-describedby="login_password-error" placeholder="Enter your password" required>
            <button type="button" class="icon-button" id="password-toggle" aria-controls="login_password" aria-label="Show password">${icon('eye')}</button>
          </div>`)}
          ${formAlert}
          <button type="submit" class="button button--primary">Sign in ${icon('arrow')}</button>
        </fieldset>
      </form>
      <p class="login-support">Need account access? Contact the Scholarship Office.</p>
    </div></section>
  </div>`;
  if (configurationMessage) return;
  const form = root.querySelector('#login-form');
  const toggle = form.querySelector('#password-toggle');
  toggle.addEventListener('click', () => {
    const password = form.elements.login_password;
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    toggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    toggle.innerHTML = icon(visible ? 'eyeOff' : 'eye');
  });
  const validate = (values) => {
    const errors = {};
    if (!form.elements.login_email.validity.valid) errors.login_email = 'Enter a valid email address.';
    if (!values.login_password) errors.login_password = 'Enter your password.';
    return errors;
  };
  validateAsYouType(form, validate);
  onForm(form, async (values) => {
    const errors = validate(values);
    setFieldErrors(form, errors);
    if (Object.keys(errors).length) return;
    try {
      const { session } = await read(client.auth.signInWithPassword({
        email: values.login_email.trim().toLowerCase(), password: values.login_password,
      }));
      await restoreSession(session);
    } catch (error) {
      if (error?.code === 'invalid_credentials') {
        formMessage(form, 'The email or password is incorrect.');
      } else if (error?.code === 'email_not_confirmed') {
        formMessage(form, 'Confirm your email address before signing in.');
      } else {
        formMessage(form, message(error));
      }
    }
  }, 'Signing in…');
}

async function restoreSession(session, force = false) {
  const nextUserId = session?.user.id ?? null;
  if (nextUserId === userId && !force) return;
  const token = ++authVersion;
  ++viewVersion;
  profile = null;
  currentPath = '';
  if (drawer.open) drawer.close();
  if (nextUserId !== userId) staffTerm = EXAM_TERM;
  userId = nextUserId;
  if (!userId) {
    if (location.hash && !force) history.replaceState(null, '', location.pathname + location.search);
    renderLogin();
    return;
  }
  root.classList.remove('login-main');
  renderHeader();
  root.innerHTML = loading('Loading your account…');
  try {
    const account = await getProfile(client, nextUserId);
    if (authVersion !== token) return;
    if (!account) {
      root.innerHTML = `<section class="panel form-panel"><h1>Account setup required</h1>
        <p>Ask the Scholarship Office to register your profile with your confirmed email address.</p>
        <button class="button button--secondary" type="button" id="retry-account">Check account again</button></section>`;
      root.querySelector('#retry-account').addEventListener('click', () => restoreSession(session, true));
      return;
    }
    profile = { ...account, email: session.user.email ?? account.email };
    await restoreRoute();
  } catch (error) {
    if (authVersion !== token) return;
    root.innerHTML = `<section class="panel form-panel"><h1>Could not load your account</h1>
      <p class="notice notice--error" role="alert">${h(message(error))}</p>
      <button class="button button--secondary" type="button" id="retry-account">Try again</button></section>`;
    root.querySelector('#retry-account').addEventListener('click', () => restoreSession(session, true));
  }
}

function isAllowed(view, id) {
  return profile && Object.hasOwn(routes, view) && view.startsWith(`${profile.role}-`)
    && (!recordRoutes.has(view) || validId.test(id ?? ''));
}

function loading(label = 'Loading page…') {
  return `<div class="page-loading" role="status">
    <span class="sr-only">${label}</span><div class="skeleton skeleton-heading"></div>
    <div class="skeleton skeleton-hero"></div><div class="metric-grid">
    ${'<div class="skeleton skeleton-metric"></div>'.repeat(4)}</div></div>`;
}

function routePath(view, options) {
  const query = new URLSearchParams();
  if (profile.role === 'staff' && (staffTerm.year !== EXAM_TERM.year || staffTerm.semester !== EXAM_TERM.semester)) {
    query.set('year', staffTerm.year);
    query.set('semester', staffTerm.semester);
  }
  if (reviewSections.includes(options.section)) query.set('section', options.section);
  if (complianceFilters.includes(options.filter)) query.set('filter', options.filter);
  return `#${view}${recordRoutes.has(view) ? `/${options.id}` : ''}${query.size ? `?${query}` : ''}`;
}

async function restoreRoute() {
  const [path, query = ''] = location.hash.slice(1).split('?');
  const [view, id] = path.split('/');
  if (!isAllowed(view, id)) return go(homeRoute(), { replace: true });
  const params = new URLSearchParams(query);
  const year = normalizeYear(params.get('year'));
  const semester = Number(params.get('semester'));
  const section = params.get('section');
  const filter = params.get('filter');
  return go(view, {
    id, section: reviewSections.includes(section) ? section : undefined,
    filter: complianceFilters.includes(filter) ? filter : undefined, replace: true,
    term: year && [1, 2].includes(semester) ? { year, semester } : EXAM_TERM,
  });
}

async function go(view, options = {}) {
  if (!isAllowed(view, options.id)) return;
  if (profile.role === 'staff' && options.term) staffTerm = options.term;
  currentPath = routePath(view, options);
  if (location.hash !== currentPath) history[options.replace ? 'replaceState' : 'pushState'](null, '', currentPath);
  const token = ++viewVersion;
  renderHeader(view, options.section);
  document.title = `${titleFor(view, options.section)[1]} | Scholarship Office`;
  root.innerHTML = loading();
  root.setAttribute('aria-busy', 'true');
  window.scrollTo(0, 0);
  const active = () => viewVersion === token;
  const mount = (markup) => {
    if (!active()) return false;
    root.innerHTML = (options.notice ? `<p class="notice notice--success" role="status">${icon('check')}${h(options.notice)}</p>` : '') + markup;
    root.removeAttribute('aria-busy');
    const heading = root.querySelector('h1');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
    if (reviewSections.includes(options.section)) jumpTo(`review-${options.section}`);
    return true;
  };
  try {
    await routes[view]({
      client, root, profile, staffTerm, mount, view,
      go: (nextView, args) => { if (active()) void go(nextView, args); },
    }, options);
  } catch (error) {
    if (!active()) return;
    mount(`<section class="panel form-panel"><h1>Could not open this view</h1>
      <p class="notice notice--error" role="alert">${h(message(error))}</p>
      <div class="actions">
        <button type="button" class="button button--primary" id="retry-view">Retry</button>
        <button type="button" class="button button--secondary" data-route="${homeRoute()}">Dashboard</button>
      </div></section>`);
    root.querySelector('#retry-view').addEventListener('click', () => go(view, { ...options, notice: '' }));
  }
}

function jumpTo(id) {
  const section = document.getElementById(id);
  if (!section) return;
  section.focus({ preventScroll: true });
  section.scrollIntoView({ block: 'start' });
}

async function canLeave() {
  if (root.querySelector('form[data-saving]')) return false;
  return !hasUnsavedChanges(root) || confirmAction('Discard unsaved changes?', 'Your changes on this page will be lost.', 'Discard changes', true);
}

async function signOut(button) {
  if (endingSession || !(await canLeave())) return;
  endingSession = true;
  button.disabled = true;
  try {
    await read(client.auth.signOut({ scope: 'local' }));
    await restoreSession(null);
  } catch (error) {
    root.querySelector('#logout-error')?.remove();
    const notice = document.createElement('p');
    notice.id = 'logout-error';
    notice.className = 'notice notice--error';
    notice.setAttribute('role', 'alert');
    notice.textContent = message(error);
    root.prepend(notice);
  } finally {
    endingSession = false;
    button.disabled = false;
  }
}

document.addEventListener('click', async (event) => {
  if (event.target.closest('.skip-link')) {
    event.preventDefault();
    jumpTo(root.id);
    return;
  }
  const account = header.querySelector('.account-menu');
  if (account?.open && !account.contains(event.target)) account.open = false;
  if (event.target.closest('[data-search]')) {
    if (!root.querySelector('#roster_search, #directory_search')) {
      if (!(await canLeave())) return;
      await go('staff-directory');
    }
    root.querySelector('#roster_search, #directory_search')?.focus();
    return;
  }
  if (event.target.closest('#menu-toggle')) { drawer.showModal(); return; }
  if (event.target === drawer || event.target.closest('[data-close-drawer]')) { drawer.close(); return; }
  const jump = event.target.closest('[data-jump]');
  if (jump) { jumpTo(jump.dataset.jump); return; }
  const button = event.target.closest('[data-route], [data-logout]');
  if (!button) return;
  if (drawer.open) drawer.close();
  if (button.hasAttribute('data-logout')) { await signOut(button); return; }
  const { route, id, section, filter } = button.dataset;
  if (isAllowed(route, id) && await canLeave()) await go(route, { id, section, filter });
});

drawer.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && drawer.open) {
    event.preventDefault();
    drawer.close();
    header.querySelector('#menu-toggle')?.focus();
  }
});

header.addEventListener('keydown', (event) => {
  const account = event.target.closest('.account-menu[open]');
  if (event.key !== 'Escape' || !account) return;
  event.preventDefault();
  account.open = false;
  account.querySelector('summary').focus();
});

window.addEventListener('popstate', async () => {
  if (!profile || location.hash === currentPath) return;
  if (await canLeave()) await restoreRoute();
  else history.pushState(null, '', currentPath);
});

window.addEventListener('beforeunload', (event) => {
  if (hasUnsavedChanges(root)) event.preventDefault();
});

window.matchMedia('(min-width: 861px)').addEventListener('change', ({ matches }) => {
  if (matches && drawer.open) drawer.close();
});

async function start() {
  setFavicon();
  renderHeader();
  try {
    client = await connect();
    if (!client) {
      renderLogin('Supabase is not configured. Set the browser URL and publishable key in the environment.');
      return;
    }
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') {
        setTimeout(() => { void restoreSession(session); }, 0);
      }
    });
    const { session } = await read(client.auth.getSession());
    await restoreSession(session, true);
  } catch (error) {
    renderLogin(message(error));
  }
}

void start();
