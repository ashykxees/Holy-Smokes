async function onAuthReady(user) {
  const list = document.getElementById('team-list');
  if (!list) return;

  try {
    const users = await fetchJSON('/api/users');
    if (!users || !users.length) {
      list.innerHTML = '<p class="p-4 text-gray-500">No team members yet.</p>';
      return;
    }

    list.innerHTML = users.map(u => `
      <div class="flex items-center gap-4 p-4">
        ${u.picture
          ? `<img src="${escapeHtml(u.picture)}" alt="" class="w-12 h-12 rounded-full object-cover border border-gray-200">`
          : `<div class="w-12 h-12 rounded-full bg-hs-green text-white flex items-center justify-center font-bold">${escapeHtml((u.name || 'U').charAt(0).toUpperCase())}</div>`
        }
        <div class="flex-1 min-w-0">
          <div class="font-medium truncate">${escapeHtml(u.name)} ${u.is_manager ? '<span class="ml-2 text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">Manager</span>' : ''}</div>
          <div class="text-sm text-gray-500 truncate">${escapeHtml(u.dc_email || u.email)}${u.nickname ? ` &middot; ${escapeHtml(u.nickname)}` : ''}</div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<p class="p-4 text-red-600">${escapeHtml(err.message)}</p>`;
  }
}

window.onAuthReady = onAuthReady;
