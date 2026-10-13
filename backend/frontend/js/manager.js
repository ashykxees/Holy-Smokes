let socket = null;

async function onAuthReady(user) {
  if (!user.is_manager) {
    window.location.href = '/dashboard';
    return;
  }
  await populateAssignees();
  document.getElementById('task-form').addEventListener('submit', createTask);
  document.getElementById('announcement-form').addEventListener('submit', postAnnouncement);
  document.getElementById('exp-form').addEventListener('submit', giveExp);
  loadExpHistory();
  document.getElementById('chat-form').addEventListener('submit', sendMessage);
  connectManagerChat(user);
}

async function populateAssignees() {
  const users = await fetchJSON('/api/users');
  const select = document.getElementById('task-assignee');
  select.innerHTML = '<option value="all">Entire Team</option>';
  const expSelect = document.getElementById('exp-user');
  for (const u of users) {
    const option = document.createElement('option');
    option.value = u.email;
    option.textContent = u.name;
    select.appendChild(option);
    expSelect.appendChild(option.cloneNode(true));
  }
}

async function giveExp(e) {
  e.preventDefault();
  const select = document.getElementById('exp-user');
  const amount = parseInt(document.getElementById('exp-amount').value, 10);
  const reason = document.getElementById('exp-reason').value.trim();
  if (!select.value || !amount) {
    showExpStatus('Choose a member and enter an EXP amount other than 0.', true);
    return;
  }
  const name = select.options[select.selectedIndex].textContent;
  try {
    const result = await fetchJSON('/api/exp/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_email: select.value, amount, reason }),
    });
    document.getElementById('exp-form').reset();
    const applied = result.applied;
    const verb = applied > 0 ? `Gave ${applied} EXP to` : `Took ${-applied} EXP from`;
    showExpStatus(`${verb} ${name}. They now have ${result.exp_total} EXP.`, false);
    loadExpHistory();
  } catch (err) {
    showExpStatus(err.message, true);
  }
}

function showExpStatus(message, isError) {
  const statusEl = document.getElementById('exp-status');
  statusEl.textContent = message;
  statusEl.classList.remove('hidden');
  statusEl.classList.toggle('text-red-600', isError);
  statusEl.classList.toggle('text-hs-green', !isError);
}

async function loadExpHistory() {
  const list = document.getElementById('exp-history');
  try {
    const rows = await fetchJSON('/api/exp/adjustments');
    if (!rows.length) {
      list.innerHTML = '<li class="py-2 text-gray-500">No EXP given yet.</li>';
      return;
    }
    list.innerHTML = rows.map(r => {
      const sign = r.amount > 0 ? '+' : '';
      const color = r.amount > 0 ? 'text-hs-green' : 'text-red-600';
      const date = new Date(r.created_at).toLocaleDateString();
      return `
        <li class="py-2 flex flex-wrap gap-x-3 gap-y-1 items-baseline">
          <span class="font-semibold ${color}">${sign}${r.amount} EXP</span>
          <span class="font-medium">${escapeHtml(r.user_name)}</span>
          ${r.reason ? `<span class="text-gray-600">${escapeHtml(r.reason)}</span>` : ''}
          <span class="text-gray-400 text-xs ml-auto">by ${escapeHtml(r.added_by_name)} &bull; ${date}</span>
        </li>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<li class="py-2 text-red-600">${escapeHtml(err.message)}</li>`;
  }
}

async function createTask(e) {
  e.preventDefault();
  const title = document.getElementById('task-title').value.trim();
  const description = document.getElementById('task-description').value.trim();
  const assignedTo = document.getElementById('task-assignee').value;
  const exp = parseInt(document.getElementById('task-exp').value, 10) || 0;
  const dueDate = document.getElementById('task-due-date').value || null;
  const dueTime = document.getElementById('task-due-time').value || null;
  try {
    await fetchJSON('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, assigned_to: assignedTo, exp, due_date: dueDate, due_time: dueTime }),
    });
    document.getElementById('task-form').reset();
    alert('Task assigned!');
  } catch (err) {
    alert(err.message);
  }
}

async function postAnnouncement(e) {
  e.preventDefault();
  const title = document.getElementById('announcement-title').value.trim();
  const content = document.getElementById('announcement-content').value.trim();
  try {
    await fetchJSON('/api/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content }),
    });
    document.getElementById('announcement-form').reset();
    alert('Announcement posted!');
  } catch (err) {
    alert(err.message);
  }
}

function connectManagerChat(user) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/ws/chat?manager=true`;
  socket = new WebSocket(url);

  socket.onopen = () => console.log('Manager chat connected');
  socket.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'message') appendMessage(payload.data, user.email);
  };
  socket.onclose = () => setTimeout(() => connectManagerChat(user), 3000);
}

function appendMessage(msg, ownEmail) {
  const container = document.getElementById('messages');
  const isOwn = msg.user_email === ownEmail;
  const el = document.createElement('div');
  el.className = `flex ${isOwn ? 'justify-end' : 'justify-start'}`;
  el.innerHTML = `
    <div class="chat-message ${isOwn ? 'own' : 'other'}">
      <div class="text-xs ${isOwn ? 'text-green-100' : 'text-gray-500'} font-medium mb-1">${escapeHtml(msg.user_name)}</div>
      <div>${escapeHtml(msg.text)}</div>
      <div class="text-[10px] ${isOwn ? 'text-green-100' : 'text-gray-400'} mt-1 text-right">${formatTime(msg.created_at)}</div>
    </div>
  `;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function sendMessage(e) {
  e.preventDefault();
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text || !socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ text }));
  input.value = '';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.onAuthReady = onAuthReady;
