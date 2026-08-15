let socket = null;

async function onAuthReady(user) {
  if (!user.is_manager) {
    window.location.href = '/dashboard';
    return;
  }
  await populateAssignees();
  document.getElementById('task-form').addEventListener('submit', createTask);
  document.getElementById('announcement-form').addEventListener('submit', postAnnouncement);
  document.getElementById('chat-form').addEventListener('submit', sendMessage);
  connectManagerChat(user);
}

async function populateAssignees() {
  const users = await fetchJSON('/api/users');
  const select = document.getElementById('task-assignee');
  select.innerHTML = '<option value="all">Entire Team</option>';
  for (const u of users) {
    const option = document.createElement('option');
    option.value = u.email;
    option.textContent = u.name;
    select.appendChild(option);
  }
}

async function createTask(e) {
  e.preventDefault();
  const title = document.getElementById('task-title').value.trim();
  const description = document.getElementById('task-description').value.trim();
  const assignedTo = document.getElementById('task-assignee').value;
  try {
    await fetchJSON('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, assigned_to: assignedTo }),
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
