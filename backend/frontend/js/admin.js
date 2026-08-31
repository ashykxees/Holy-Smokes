async function onAuthReady(user) {
  if (!user || !user.is_owner) {
    window.location.href = '/dashboard';
    return;
  }
  currentUser = user;
  await Promise.all([loadUsers(), loadEmailLog()]);
}

async function loadEmailLog() {
  const container = document.getElementById('email-log-list');
  if (!container) return;

  try {
    const logs = await fetchJSON('/api/admin/email-log');
    if (!logs || logs.length === 0) {
      container.innerHTML = '<p class="text-gray-500 text-sm">No emails sent yet.</p>';
      return;
    }

    const grouped = {};
    for (const log of logs) {
      const key = log.sender_email;
      if (!grouped[key]) {
        grouped[key] = {
          name: log.sender_name || log.sender_email,
          email: log.sender_email,
          logs: [],
        };
      }
      grouped[key].logs.push(log);
    }

    container.innerHTML = Object.values(grouped).map(person => `
      <div class="border border-gray-200 rounded-lg overflow-hidden">
        <div class="bg-gray-50 px-4 py-3 border-b border-gray-200">
          <div class="font-semibold text-sm">${escapeHtml(person.name)}</div>
          <div class="text-xs text-gray-500">${escapeHtml(person.email)}</div>
        </div>
        <ul class="max-h-80 overflow-y-auto divide-y divide-gray-100">
          ${person.logs.map((log, index) => `
            <li class="p-4 ${index === 0 ? 'bg-hs-cream' : ''}">
              <div class="flex items-center justify-between mb-1">
                <span class="text-xs font-semibold uppercase tracking-wide ${log.type === 'send' ? 'text-hs-green' : 'text-gray-500'}">${log.type === 'send' ? 'Original' : 'Reply'}</span>
                <span class="text-xs text-gray-500">${formatTime(log.sent_at)}</span>
              </div>
              <div class="text-sm font-medium text-gray-900 mb-1">To: ${escapeHtml(log.to_address)}</div>
              <div class="text-sm text-gray-700 font-semibold mb-2">${escapeHtml(log.subject)}</div>
              <div class="text-sm text-gray-600 whitespace-pre-wrap line-clamp-4">${escapeHtml((log.body_text || '').substring(0, 400))}${(log.body_text || '').length > 400 ? '…' : ''}</div>
            </li>
          `).join('')}
        </ul>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<p class="text-red-600 text-sm">Failed to load email log: ${escapeHtml(err.message)}</p>`;
  }
}

async function loadUsers() {
  const list = document.getElementById('admin-list');
  if (!list) return;

  try {
    const users = await fetchJSON('/api/admin/users');
    if (!users || !users.length) {
      list.innerHTML = '<p class="p-4 text-gray-500">No team members yet.</p>';
      return;
    }

    list.innerHTML = users.map(u => `
      <div class="flex items-center justify-between p-4 gap-4">
        <div class="flex items-center gap-4 min-w-0">
          ${u.picture
            ? `<img src="${escapeHtml(u.picture)}" alt="" class="w-12 h-12 rounded-full object-cover border border-gray-200">`
            : `<div class="w-12 h-12 rounded-full bg-hs-green text-white flex items-center justify-center font-bold">${escapeHtml((u.name || 'U').charAt(0).toUpperCase())}</div>`
          }
          <div class="min-w-0">
            <div class="font-medium truncate">${escapeHtml(u.name)} ${u.is_owner ? '<span class="ml-2 text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">Owner</span>' : ''}</div>
            <div class="text-sm text-gray-500 truncate">${escapeHtml(u.dc_email || u.email)}${u.nickname ? ` &middot; ${escapeHtml(u.nickname)}` : ''}</div>
            ${u.phone ? `<div class="text-xs text-gray-400">${escapeHtml(u.phone)}</div>` : ''}
          </div>
        </div>
        ${u.is_owner || u.email === currentUser.email ? '' : `
          <button onclick="toggleManager('${escapeHtml(u.email)}', ${!u.is_manager})" class="${!u.is_manager ? 'btn-primary' : 'btn-secondary'} whitespace-nowrap">
            ${u.is_manager ? 'Demote' : 'Make Manager'}
          </button>
          <select onchange="setTeam('${escapeHtml(u.email)}', this.value)" class="ml-2 px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white whitespace-nowrap">
            <option value="" ${u.team_number ? '' : 'selected'}>No team</option>
            <option value="1" ${u.team_number === 1 ? 'selected' : ''}>Team 1</option>
            <option value="2" ${u.team_number === 2 ? 'selected' : ''}>Team 2</option>
          </select>
          <button onclick="removeUser('${escapeHtml(u.email)}')" class="btn-secondary whitespace-nowrap text-red-600 border-red-200 hover:bg-red-50 ml-2">Remove</button>
        `}
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<p class="p-4 text-red-600">${escapeHtml(err.message)}</p>`;
  }
}

async function toggleManager(email, makeManager) {
  try {
    await fetchJSON(`/api/admin/users/${encodeURIComponent(email)}/manager`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_manager: makeManager }),
    });
    await loadUsers();
  } catch (err) {
    alert(err.message);
  }
}

async function setTeam(email, teamNumber) {
  const value = teamNumber === '' ? null : parseInt(teamNumber, 10);
  try {
    await fetchJSON(`/api/admin/users/${encodeURIComponent(email)}/team`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_number: value }),
    });
    await loadUsers();
  } catch (err) {
    alert(err.message);
  }
}

async function removeUser(email) {
  if (!confirm(`Remove ${email} from the portal? This cannot be undone.`)) return;
  try {
    await fetchJSON(`/api/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
    await loadUsers();
  } catch (err) {
    alert(err.message);
  }
}

window.onAuthReady = onAuthReady;
