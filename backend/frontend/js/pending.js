function onAuthReady(user) {
  if (!user || !user.is_manager) {
    window.location.href = '/dashboard';
    return;
  }
  loadPending();
}

async function loadPending() {
  const list = document.getElementById('pending-list');
  try {
    const users = await fetchJSON('/api/admin/pending');
    if (!users.length) {
      list.innerHTML = '<li class="text-gray-500 text-sm p-2">No users awaiting acceptance.</li>';
      return;
    }
    list.innerHTML = users.map(u => `
      <li class="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 border border-gray-100 rounded-lg bg-white">
        <div class="flex-1 min-w-0">
          <div class="font-medium">${escapeHtml(u.name)}</div>
          <div class="text-sm text-gray-600">${escapeHtml(u.email)}${u.dc_email && u.dc_email !== u.email ? ` / ${escapeHtml(u.dc_email)}` : ''}</div>
          <div class="text-xs text-gray-500 mt-1">
            ${u.phone ? `Phone: ${escapeHtml(u.phone)}` : 'No phone'}
            ${u.is_dc_employee ? '&bull; DC Employee' : ''}
            &bull; Joined ${formatTime(u.created_at)}
          </div>
        </div>
        <div class="flex gap-2">
          <button onclick="approveUser('${escapeJsString(u.email)}')" class="btn-primary text-sm">Accept</button>
          <button onclick="rejectUser('${escapeJsString(u.email)}')" class="text-red-600 hover:text-red-800 text-sm font-medium px-3 py-2 rounded-lg border border-red-200 hover:bg-red-50">Reject</button>
        </div>
      </li>
    `).join('');
  } catch (err) {
    list.innerHTML = `<li class="text-red-500 text-sm p-2">${err.message}</li>`;
  }
}

async function approveUser(email) {
  try {
    await fetchJSON(`/api/admin/users/${encodeURIComponent(email)}/approve`, { method: 'POST' });
    loadPending();
  } catch (err) {
    alert(err.message);
  }
}

async function rejectUser(email) {
  if (!confirm('Reject and delete this user?')) return;
  try {
    await fetchJSON(`/api/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
    loadPending();
  } catch (err) {
    alert(err.message);
  }
}

function escapeJsString(text) {
  if (!text) return '';
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

window.onAuthReady = onAuthReady;
