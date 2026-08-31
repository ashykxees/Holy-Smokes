let currentUser = null;

const QUOTES = [
  "Good teams become great ones when the members trust each other enough to surrender the 'me' for the 'we'. – Phil Jackson",
  "The strength of the team is each individual member. The strength of each member is the team. – Phil Jackson",
  "Alone we can do so little; together we can do so much. – Helen Keller",
  "Teamwork makes the dream work. – John C. Maxwell",
  "Success is best when it's shared. – Howard Schultz",
  "Coming together is a beginning, staying together is progress, and working together is success. – Henry Ford",
  "If everyone is moving forward together, then success takes care of itself. – Henry Ford",
  "None of us is as smart as all of us. – Ken Blanchard",
  "Talent wins games, but teamwork wins championships. – Michael Jordan",
  "It takes two flints to make a fire. – Louisa May Alcott",
  "Unity is strength. – Aesop",
  "A successful team is a group of many hands and one mind. – Bill Bethel",
  "The way a team plays as a whole determines its success. – Babe Ruth",
  "We are all in the gutter, but some of us are looking at the stars. – Oscar Wilde",
  "Do what you can, with what you have, where you are. – Theodore Roosevelt",
];

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, { credentials: 'include', ...options });
  if (res.status === 401) {
    if (!isAuthPage()) {
      window.location.href = '/login';
    }
    return null;
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

function isAuthPage() {
  const path = window.location.pathname;
  return path === '/login' || path === '/onboarding' || path === '/awaiting';
}

function isOnboardingPage() {
  return window.location.pathname === '/onboarding';
}

function isAwaitingPage() {
  return window.location.pathname === '/awaiting';
}

async function initAuth() {
  const loginPage = window.location.pathname === '/login';
  const onboardingPage = isOnboardingPage();
  const awaitingPage = isAwaitingPage();
  try {
    const user = await fetchJSON('/api/me');
    currentUser = user;

    if (user && !user.is_approved) {
      if (!awaitingPage) {
        window.location.href = '/awaiting';
      } else {
        if (window.onAuthReady) window.onAuthReady(user);
      }
      return;
    }

    if (user && user.is_approved && awaitingPage) {
      window.location.href = '/dashboard';
      return;
    }

    if (loginPage && user) {
      window.location.href = user.onboarding_completed ? '/dashboard' : '/onboarding';
      return;
    }
    if (user && !user.onboarding_completed && !onboardingPage) {
      window.location.href = '/onboarding';
      return;
    }
    if (user && user.onboarding_completed && onboardingPage) {
      window.location.href = '/dashboard';
      return;
    }
    buildNav(user);
    if (window.onAuthReady) window.onAuthReady(user);
  } catch (err) {
    if (!loginPage && !onboardingPage && !awaitingPage) {
      window.location.href = '/login';
    } else if (window.onAuthReady) {
      window.onAuthReady(null);
    }
  }
}

function buildNav(user) {
  const nav = document.getElementById('nav');
  if (!nav) return;
  document.body.classList.add('portal-layout');
  const path = window.location.pathname;
  const linkClass = (href) => `nav-link ${path === href ? 'active' : ''}`;

  const managerLink = user && user.is_manager
    ? `<a href="/manager" class="${linkClass('/manager')}">
         <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
         Manager
       </a>
       <a href="/completed" class="${linkClass('/completed')}">
         <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
         Completed
       </a>
       <a href="/pending" class="${linkClass('/pending')}">
         <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
         Awaiting Acceptance
       </a>
       <a href="/catering-requests" class="${linkClass('/catering-requests')}">
         <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
         Catering Requests
       </a>`
    : '';

  const adminLink = user && user.is_owner
    ? `<a href="/admin" class="${linkClass('/admin')}">
         <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82V9a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>
         Admin
       </a>`
    : '';

  const profilePic = user && user.picture
    ? `<img src="${escapeHtml(user.picture)}" alt="" class="w-8 h-8 rounded-full object-cover border border-gray-200">`
    : `<div class="w-8 h-8 rounded-full bg-hs-green text-white flex items-center justify-center text-sm font-bold">${(user && user.name ? user.name : 'U').charAt(0).toUpperCase()}</div>`;

  nav.innerHTML = `
    <div class="p-6">
      <a href="/dashboard" class="flex items-center gap-3">
        <img src="/assets/logo.png" alt="Holy Smokes" class="h-12 w-auto object-contain">
        <div>
          <div class="font-bold text-lg tracking-tight leading-none">HOLY SMOKES</div>
          <div class="text-xs text-gray-500 tracking-widest">BBQ TEAM</div>
        </div>
      </a>
    </div>
    <nav class="px-4 pb-4 flex-1 space-y-1">
      <a href="/dashboard" class="${linkClass('/dashboard')}">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        Dashboard
      </a>
      <a href="/email" class="${(path === '/email' || path === '/inbox') ? 'nav-link active' : 'nav-link'}">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
        Mail
      </a>
      <a href="/chat" class="${linkClass('/chat')}">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Chat
      </a>
      <a href="/tasks" class="${linkClass('/tasks')}">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        Tasks
      </a>
      <a href="/exp" class="${linkClass('/exp')}">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        EXP
      </a>
      ${managerLink}
      ${adminLink}
      <a href="/team" class="${linkClass('/team')}">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        My Team
      </a>
      <a href="/emergency" class="${linkClass('/emergency')}">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        Emergency
      </a>
      <a href="/settings" class="${linkClass('/settings')}">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82V9a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>
        Settings
      </a>
    </nav>
    <div class="px-4 pb-4 mt-auto space-y-3">
      <div class="flex items-center gap-3 p-2 rounded-lg border border-gray-100">
        ${profilePic}
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium truncate">${escapeHtml(user ? user.name : 'Guest')}</div>
          <div class="text-xs text-gray-500 truncate">${escapeHtml(user ? user.email : '')}</div>
        </div>
      </div>
      <button onclick="logout()" class="btn-secondary w-full flex items-center justify-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Log out
      </button>
    </div>
  `;
}

async function logout() {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/login';
}

function randomQuote() {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.addEventListener('load', initAuth);
