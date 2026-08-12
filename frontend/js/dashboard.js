function onAuthReady(user) {
  const hour = new Date().getHours();
  let greeting = 'Good morning';
  if (hour >= 12) greeting = 'Good afternoon';
  if (hour >= 18) greeting = 'Good evening';
  document.getElementById('greeting').textContent = `${greeting}, ${user.name}!`;

  document.getElementById('quote').textContent = randomQuote();

  loadCompletedTasks(user);
  loadAnnouncements();
}

async function loadCompletedTasks(user) {
  try {
    const tasks = await fetchJSON('/api/tasks');
    const completed = tasks.filter(t => t.completed);
    const list = document.getElementById('completed-tasks');
    if (!completed.length) {
      list.innerHTML = '<li class="text-gray-500 text-sm">No completed tasks yet.</li>';
      return;
    }
    list.innerHTML = completed.map(t => `
      <li class="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
        <svg class="text-green-600 mt-0.5 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        <div>
          <div class="font-medium">${escapeHtml(t.title)}</div>
          <div class="text-xs text-gray-500">${t.assigned_to === 'all' ? 'Team' : 'Assigned to ' + escapeHtml(t.assigned_to)} • completed ${formatTime(t.completed_at)}</div>
        </div>
      </li>
    `).join('');
  } catch (err) {
    document.getElementById('completed-tasks').innerHTML = `<li class="text-red-500 text-sm">${err.message}</li>`;
  }
}

async function loadAnnouncements() {
  try {
    const announcements = await fetchJSON('/api/announcements');
    const list = document.getElementById('announcements');
    if (!announcements.length) {
      list.innerHTML = '<li class="text-gray-500 text-sm">No announcements yet.</li>';
      return;
    }
    list.innerHTML = announcements.map(a => `
      <li class="p-3 bg-gray-50 rounded-lg">
        <div class="font-medium">${escapeHtml(a.title)}</div>
        <div class="text-sm text-gray-700 mt-1">${escapeHtml(a.content)}</div>
        <div class="text-xs text-gray-500 mt-2">${escapeHtml(a.author_name)} • ${formatTime(a.created_at)}</div>
      </li>
    `).join('');
  } catch (err) {
    document.getElementById('announcements').innerHTML = `<li class="text-red-500 text-sm">${err.message}</li>`;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
