(function() {

function displayName(user) {
  const first = (user.first_name || '').trim() || (user.nickname || '').trim();
  if (first) return first;
  return user.name ? user.name.split(' ')[0] : user.email.split('@')[0];
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

let currentUser = null;
let currentEmailId = null;
let currentTab = 'inbox';

function setTab(tab) {
  currentTab = tab;
  const inboxPanel = document.getElementById('inbox-panel');
  const composePanel = document.getElementById('compose-panel');
  const inboxBtn = document.getElementById('tab-inbox');
  const archivedBtn = document.getElementById('tab-archived');
  const composeBtn = document.getElementById('tab-compose');

  [inboxBtn, archivedBtn, composeBtn].forEach(btn => {
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-secondary');
  });

  if (tab === 'compose') {
    inboxPanel.classList.add('hidden');
    composePanel.classList.remove('hidden');
    composeBtn.classList.replace('btn-secondary', 'btn-primary');
    updateSignaturePreview();
  } else {
    composePanel.classList.add('hidden');
    inboxPanel.classList.remove('hidden');
    if (tab === 'inbox') {
      inboxBtn.classList.replace('btn-secondary', 'btn-primary');
    } else if (tab === 'archived') {
      archivedBtn.classList.replace('btn-secondary', 'btn-primary');
    }
    loadInbox(tab === 'archived');
  }
}

function updateSignaturePreview() {
  const preview = document.getElementById('signature-preview');
  if (!preview || !currentUser) return;
  const name = displayName(currentUser);
  const text = `--\n${name}\nHoly Smokes BBQ Team\nholysmokes.cc`;
  preview.innerHTML = text.split('\n').map(line => escapeHtml(line)).join('<br>');
}

function showInboxList() {
  document.getElementById('emails-list').closest('.card').classList.remove('hidden');
  document.getElementById('inbox-detail').classList.add('hidden');
  currentEmailId = null;
}

function showInboxDetail() {
  document.getElementById('emails-list').closest('.card').classList.add('hidden');
  document.getElementById('inbox-detail').classList.remove('hidden');
}

async function loadInbox(archived = false) {
  const list = document.getElementById('emails-list');
  try {
    const url = archived ? '/api/inbox?archived=1' : '/api/inbox';
    const emails = await fetchJSON(url);
    if (!emails || emails.length === 0) {
      list.innerHTML = `<li class="text-gray-500 text-sm">No ${archived ? 'archived ' : ''}messages yet.</li>`;
      return;
    }
    list.innerHTML = emails.map(e => `
      <li class="p-3 rounded-lg hover:bg-gray-50 cursor-pointer border border-transparent hover:border-gray-200 transition" data-id="${e.id}">
        <div class="flex items-center justify-between mb-1">
          <span class="font-semibold text-sm">${escapeHtml(e.from_name || e.from_address)}</span>
          <span class="text-xs text-gray-500">${formatTime(e.received_at)}</span>
        </div>
        <div class="text-sm font-medium text-gray-900 truncate">${escapeHtml(e.subject)}</div>
        <div class="text-xs text-gray-500 truncate">${escapeHtml(e.snippet || '')}</div>
      </li>
    `).join('');

    list.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => loadEmail(li.dataset.id));
    });
  } catch (err) {
    list.innerHTML = `<li class="text-red-600 text-sm">Failed to load inbox: ${escapeHtml(err.message)}</li>`;
  }
}

async function loadEmail(id) {
  currentEmailId = id;
  try {
    const email = await fetchJSON(`/api/inbox/${id}`);
    document.getElementById('detail-subject').textContent = email.subject;
    document.getElementById('detail-from').textContent = `From: ${email.from_name ? `${email.from_name} <${email.from_address}>` : email.from_address}`;
    document.getElementById('detail-to').textContent = `To: ${email.to_address}`;
    document.getElementById('detail-time').textContent = formatTime(email.received_at);
    document.getElementById('detail-body').textContent = email.body_text || '(No message body)';

    const archiveBtn = document.getElementById('archive-btn');
    archiveBtn.textContent = email.archived ? 'Unarchive' : 'Archive';
    archiveBtn.disabled = false;

    const repliesList = document.getElementById('replies-list');
    if (email.replies && email.replies.length) {
      repliesList.innerHTML = email.replies.map(r => `
        <div class="card bg-gray-50">
          <div class="text-xs text-gray-500 mb-1">${formatTime(r.sent_at)}</div>
          <div class="text-sm text-gray-800 whitespace-pre-wrap">${escapeHtml(r.body_text || '')}</div>
        </div>
      `).join('');
    } else {
      repliesList.innerHTML = '';
    }

    showInboxDetail();
  } catch (err) {
    alert(`Failed to load email: ${err.message}`);
  }
}

async function toggleArchive() {
  if (!currentEmailId) return;
  const archiveBtn = document.getElementById('archive-btn');
  const previousLabel = archiveBtn.textContent;
  archiveBtn.disabled = true;
  archiveBtn.textContent = 'Saving...';
  try {
    await fetchJSON(`/api/inbox/${currentEmailId}/archive`, { method: 'POST' });
    showInboxList();
    setTab(currentTab);
  } catch (err) {
    alert(`Failed to update archive status: ${err.message}`);
    archiveBtn.disabled = false;
    archiveBtn.textContent = previousLabel;
  }
}

async function sendReply(e) {
  e.preventDefault();
  if (!currentEmailId) return;
  const body = document.getElementById('reply-body').value.trim();
  if (!body) return;

  const btn = document.getElementById('reply-btn');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    await fetchJSON(`/api/inbox/${currentEmailId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    document.getElementById('reply-body').value = '';
    await loadEmail(currentEmailId);
  } catch (err) {
    alert(`Failed to send reply: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send Reply';
  }
}

async function sendCompose(e) {
  e.preventDefault();
  const form = document.getElementById('compose-form');
  const btn = document.getElementById('compose-submit');
  const success = document.getElementById('compose-success');

  const data = {
    to: document.getElementById('to').value.trim(),
    subject: document.getElementById('subject').value.trim(),
    body: document.getElementById('body').value.trim(),
  };

  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    await fetchJSON('/api/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    form.reset();
    success.classList.remove('hidden');
  } catch (err) {
    alert(err.message || 'Failed to send email.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send Email';
  }
}

window.onAuthReady = async (user) => {
  if (!user) {
    window.location.href = '/login';
    return;
  }
  currentUser = user;

  document.getElementById('tab-inbox').addEventListener('click', () => setTab('inbox'));
  document.getElementById('tab-archived').addEventListener('click', () => setTab('archived'));
  document.getElementById('tab-compose').addEventListener('click', () => setTab('compose'));
  document.getElementById('back-to-inbox-list').addEventListener('click', showInboxList);
  document.getElementById('reply-form').addEventListener('submit', sendReply);
  document.getElementById('compose-form').addEventListener('submit', sendCompose);
  document.getElementById('archive-btn').addEventListener('click', toggleArchive);

  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  const path = window.location.pathname;
  if (tab === 'compose') {
    setTab('compose');
  } else if (tab === 'archived') {
    setTab('archived');
  } else {
    setTab('inbox');
  }
};

})();
