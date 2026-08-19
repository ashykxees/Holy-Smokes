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

let currentEmailId = null;

function showList() {
  document.getElementById('inbox-list').classList.remove('hidden');
  document.getElementById('inbox-detail').classList.add('hidden');
  document.getElementById('back-btn').classList.add('hidden');
  currentEmailId = null;
}

function showDetail() {
  document.getElementById('inbox-list').classList.add('hidden');
  document.getElementById('inbox-detail').classList.remove('hidden');
  document.getElementById('back-btn').classList.remove('hidden');
}

async function loadInbox() {
  const list = document.getElementById('emails-list');
  try {
    const emails = await fetchJSON('/api/inbox');
    if (!emails || emails.length === 0) {
      list.innerHTML = '<li class="text-gray-500 text-sm">No messages yet.</li>';
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

    showDetail();
  } catch (err) {
    alert(`Failed to load email: ${err.message}`);
  }
}

window.onAuthReady = async (user) => {
  if (!user) {
    window.location.href = '/login';
    return;
  }

  document.getElementById('back-btn').addEventListener('click', showList);

  const replyForm = document.getElementById('reply-form');
  const replyBtn = document.getElementById('reply-btn');
  replyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentEmailId) return;
    const body = document.getElementById('reply-body').value.trim();
    if (!body) return;

    replyBtn.disabled = true;
    replyBtn.textContent = 'Sending...';
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
      replyBtn.disabled = false;
      replyBtn.textContent = 'Send Reply';
    }
  });

  await loadInbox();
};
