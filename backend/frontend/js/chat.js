let socket = null;

function onAuthReady(user) {
  const isManagerChat = document.body.dataset.channel === 'manager';
  connectSocket(user, isManagerChat);
  document.getElementById('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage(user);
  });
}

function connectSocket(user, manager = false) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/ws/chat${manager ? '?manager=true' : ''}`;
  socket = new WebSocket(url);

  socket.onopen = () => {
    console.log('Chat connected');
  };

  socket.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'message') {
      appendMessage(payload.data, user.email);
    }
  };

  socket.onclose = () => {
    console.log('Chat disconnected, retrying...');
    setTimeout(() => connectSocket(user, manager), 3000);
  };

  socket.onerror = (err) => {
    console.error('Chat error', err);
  };
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

function sendMessage(user) {
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
