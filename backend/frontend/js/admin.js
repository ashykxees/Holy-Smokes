async function onAuthReady(user) {
  if (!user || !user.is_owner) {
    window.location.href = '/dashboard';
    return;
  }
  currentUser = user;
  await loadUsers();
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
