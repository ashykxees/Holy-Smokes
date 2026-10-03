// Edit these to change the quota or due date.
const SERVICE_HOURS_QUOTA = 15;
const SERVICE_HOURS_DEADLINE = '2027-06-05';

function onAuthReady(user) {
  document.querySelectorAll('.quota').forEach(el => { el.textContent = SERVICE_HOURS_QUOTA; });
  renderCountdown();
  setInterval(renderCountdown, 60 * 1000);
  loadMyHours();
  if (user && user.is_manager) {
    document.getElementById('manager-section').classList.remove('hidden');
    setupManager();
  }
}

function daysUntilDeadline() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadline = new Date(SERVICE_HOURS_DEADLINE + 'T00:00:00');
  return Math.round((deadline - today) / 86400000);
}

function renderCountdown() {
  const days = daysUntilDeadline();
  const deadlineLabel = new Date(SERVICE_HOURS_DEADLINE + 'T00:00:00')
    .toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const el = document.getElementById('days-left');
  const text = document.getElementById('deadline-text');
  if (days > 0) {
    el.textContent = `${days} day${days === 1 ? '' : 's'}`;
    text.textContent = `left until ${deadlineLabel}`;
  } else if (days === 0) {
    el.textContent = 'Today';
    text.textContent = `Hours are due today, ${deadlineLabel}`;
  } else {
    el.textContent = 'Past due';
    text.textContent = `The deadline was ${deadlineLabel}`;
  }
}

function formatHours(h) {
  return Number(h).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function entryHtml(e, canDelete) {
  const date = e.service_date
    ? new Date(e.service_date + 'T00:00:00').toLocaleDateString()
    : new Date(e.created_at).toLocaleDateString();
  return `
    <li class="flex items-center justify-between gap-3 p-3 border border-gray-100 rounded-lg">
      <div>
        <div class="font-medium">${formatHours(e.hours)} hr${e.hours === 1 ? '' : 's'}${e.description ? ' &middot; ' + escapeHtml(e.description) : ''}</div>
        <div class="text-xs text-gray-500">${date} &middot; added by ${escapeHtml(e.added_by_name || '')}</div>
      </div>
      ${canDelete ? `<button onclick="deleteEntry(${e.id})" class="text-red-500 text-sm hover:underline">Remove</button>` : ''}
    </li>`;
}

async function loadMyHours() {
  try {
    const data = await fetchJSON('/api/service-hours/me');
    const total = data.total || 0;
    const remaining = Math.max(0, SERVICE_HOURS_QUOTA - total);
    document.getElementById('my-total').textContent = formatHours(total);
    document.getElementById('my-progress').style.width = `${Math.min(100, (total / SERVICE_HOURS_QUOTA) * 100)}%`;
    document.getElementById('my-remaining').textContent = remaining > 0
      ? `${formatHours(remaining)} hours to go`
      : 'Quota complete. Great work!';
    const list = document.getElementById('my-entries');
    list.innerHTML = data.entries.length
      ? data.entries.map(e => entryHtml(e, false)).join('')
      : '<li class="text-gray-500 text-sm">No service hours logged yet.</li>';
  } catch (err) {
    document.getElementById('my-remaining').textContent = err.message;
  }
}

async function setupManager() {
  const select = document.getElementById('hours-user');
  try {
    const users = await fetchJSON('/api/users');
    select.innerHTML = '<option value="">Select a person...</option>' + users
      .map(u => `<option value="${escapeHtml(u.email)}">${escapeHtml(u.name)} (${escapeHtml(u.email)})</option>`)
      .join('');
  } catch (err) {
    document.getElementById('hours-status').textContent = err.message;
  }
  select.addEventListener('change', () => loadSelected());
  document.getElementById('hours-form').addEventListener('submit', addHours);
}

async function loadSelected() {
  const select = document.getElementById('hours-user');
  const summary = document.getElementById('selected-summary');
  if (!select.value) {
    summary.classList.add('hidden');
    return;
  }
  const data = await fetchJSON(`/api/service-hours/user?email=${encodeURIComponent(select.value)}`);
  const name = select.options[select.selectedIndex].text.replace(/ \(.*\)$/, '');
  document.getElementById('selected-name').textContent =
    `${name}: ${formatHours(data.total)} / ${SERVICE_HOURS_QUOTA} hrs`;
  document.getElementById('selected-entries').innerHTML = data.entries.length
    ? data.entries.map(e => entryHtml(e, true)).join('')
    : '<li class="text-gray-500 text-sm">No hours logged yet.</li>';
  summary.classList.remove('hidden');
}

async function addHours(e) {
  e.preventDefault();
  const status = document.getElementById('hours-status');
  status.className = 'text-sm ml-2';
  try {
    await fetchJSON('/api/service-hours', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_email: document.getElementById('hours-user').value,
        hours: document.getElementById('hours-amount').value,
        service_date: document.getElementById('hours-date').value,
        description: document.getElementById('hours-description').value,
      }),
    });
    status.textContent = 'Hours added.';
    status.classList.add('text-green-700');
    document.getElementById('hours-amount').value = '';
    document.getElementById('hours-description').value = '';
    await loadSelected();
    loadMyHours();
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('text-red-500');
  }
}

async function deleteEntry(id) {
  if (!confirm('Remove this service hours entry?')) return;
  try {
    await fetchJSON(`/api/service-hours/${id}`, { method: 'DELETE' });
    await loadSelected();
    loadMyHours();
  } catch (err) {
    alert(err.message);
  }
}

window.onAuthReady = onAuthReady;
