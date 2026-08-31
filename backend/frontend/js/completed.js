function onAuthReady(user) {
  if (!user || !user.is_manager) {
    window.location.href = '/dashboard';
    return;
  }
  loadCompletedTasks();
}

async function loadCompletedTasks() {
  const list = document.getElementById('completed-tasks');
  try {
    const tasks = await fetchJSON('/api/tasks?completed=true');
    if (!tasks.length) {
      list.innerHTML = '<li class="text-gray-500 text-sm p-2">No completed tasks yet.</li>';
      return;
    }
    list.innerHTML = tasks.map(t => `
      <li class="p-4 border border-gray-100 rounded-lg bg-gray-50">
        <div class="flex items-center gap-2">
          <div class="font-medium">${escapeHtml(t.title)}</div>
          <span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-800">+${t.exp || 0} EXP</span>
        </div>
        ${t.description ? `<div class="text-sm text-gray-600 mt-1">${escapeHtml(t.description)}</div>` : ''}
        <div class="text-xs text-gray-500 mt-2">
          ${t.assigned_to === 'all' ? 'Assigned to entire team' : 'Assigned to ' + escapeHtml(t.assigned_to)}
          ${t.due_date ? `• Due ${new Date(t.due_date + 'T00:00:00').toLocaleDateString()}${t.due_time ? ' at ' + t.due_time : ''}` : ''}
          • completed by ${escapeHtml(t.completed_by || 'Unknown')} ${formatTime(t.completed_at)}
        </div>
      </li>
    `).join('');
  } catch (err) {
    list.innerHTML = `<li class="text-red-500 text-sm p-2">${err.message}</li>`;
  }
}

window.onAuthReady = onAuthReady;
