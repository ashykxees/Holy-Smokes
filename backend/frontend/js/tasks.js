function onAuthReady(user) {
  loadTasks(user);
}

async function loadTasks(user) {
  try {
    const tasks = await fetchJSON('/api/tasks');
    const list = document.getElementById('tasks');
    if (!tasks.length) {
      list.innerHTML = '<li class="text-gray-500 text-sm p-2">No tasks assigned yet.</li>';
      return;
    }
    list.innerHTML = tasks.map(t => `
      <li class="flex items-start gap-3 p-4 border border-gray-100 rounded-lg ${t.completed ? 'bg-gray-50' : 'bg-white'}">
        <input type="checkbox" ${t.completed ? 'checked' : ''} onchange="toggleTask(${t.id}, this.checked)" class="mt-1 h-5 w-5 accent-green-700 cursor-pointer">
        <div class="flex-1 ${t.completed ? 'line-through text-gray-400' : ''}">
          <div class="font-medium">${escapeHtml(t.title)}</div>
          ${t.description ? `<div class="text-sm text-gray-600 mt-1">${escapeHtml(t.description)}</div>` : ''}
          <div class="text-xs text-gray-500 mt-2">
            ${t.assigned_to === 'all' ? 'Assigned to entire team' : 'Assigned to ' + escapeHtml(t.assigned_to)}
            ${t.completed ? `• completed by ${escapeHtml(t.completed_by)} ${formatTime(t.completed_at)}` : ''}
          </div>
        </div>
        ${user.is_manager ? `<button onclick="deleteTask(${t.id})" class="text-red-500 text-sm hover:underline">Delete</button>` : ''}
      </li>
    `).join('');
  } catch (err) {
    document.getElementById('tasks').innerHTML = `<li class="text-red-500 text-sm">${err.message}</li>`;
  }
}

async function toggleTask(id, completed) {
  try {
    await fetchJSON(`/api/tasks/${id}/complete`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed }),
    });
    const user = await fetchJSON('/api/me');
    loadTasks(user);
  } catch (err) {
    alert(err.message);
  }
}

async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  try {
    await fetchJSON(`/api/tasks/${id}`, { method: 'DELETE' });
    const user = await fetchJSON('/api/me');
    loadTasks(user);
  } catch (err) {
    alert(err.message);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
