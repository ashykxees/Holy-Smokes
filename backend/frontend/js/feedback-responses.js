let members = [];
let selectedEmail = null;

async function onAuthReady(user) {
  if (!user.is_manager) {
    window.location.href = '/dashboard';
    return;
  }
  document.getElementById('member-search').addEventListener('input', renderMemberList);
  await loadData();
}

async function loadData() {
  try {
    const [users, responses] = await Promise.all([
      fetchJSON('/api/users'),
      fetchJSON('/api/feedback'),
    ]);
    const byEmail = new Map();
    for (const u of users) {
      byEmail.set(u.email, { email: u.email, name: u.name, responses: [] });
    }
    for (const r of responses) {
      if (!byEmail.has(r.user_email)) {
        byEmail.set(r.user_email, { email: r.user_email, name: r.user_name || r.user_email, responses: [] });
      }
      byEmail.get(r.user_email).responses.push(r);
    }
    members = [...byEmail.values()].sort((a, b) => {
      if (!!b.responses.length !== !!a.responses.length) {
        return b.responses.length ? 1 : -1;
      }
      return (a.name || '').localeCompare(b.name || '');
    });

    const responded = members.filter(m => m.responses.length).length;
    document.getElementById('summary').textContent =
      `${responses.length} response${responses.length === 1 ? '' : 's'} from ${responded} of ${members.length} members.`;

    renderMemberList();
    const first = members.find(m => m.responses.length);
    if (first) {
      selectMember(first.email);
    }
  } catch (err) {
    document.getElementById('summary').textContent = err.message;
  }
}

function renderMemberList() {
  const query = document.getElementById('member-search').value.trim().toLowerCase();
  const list = document.getElementById('member-list');
  const shown = members.filter(m =>
    !query || (m.name || '').toLowerCase().includes(query) || m.email.toLowerCase().includes(query));
  if (!shown.length) {
    list.innerHTML = '<p class="text-sm text-gray-500 px-2 py-2">No members found.</p>';
    return;
  }
  list.innerHTML = shown.map(m => `
    <button type="button" class="fr-member ${m.email === selectedEmail ? 'active' : ''}" data-email="${escapeHtml(m.email)}">
      <span class="min-w-0">
        <span class="block font-medium truncate">${escapeHtml(m.name)}</span>
        <span class="block text-xs text-gray-500 truncate">${escapeHtml(m.email)}</span>
      </span>
      <span class="fr-count ${m.responses.length ? '' : 'none'}">${m.responses.length}</span>
    </button>`).join('');
  list.querySelectorAll('.fr-member').forEach(button => {
    button.addEventListener('click', () => selectMember(button.dataset.email));
  });
}

function selectMember(email) {
  selectedEmail = email;
  renderMemberList();
  const member = members.find(m => m.email === email);
  const detail = document.getElementById('member-detail');
  if (!member.responses.length) {
    detail.className = 'card';
    detail.innerHTML = `
      <h2 class="text-xl font-semibold">${escapeHtml(member.name)}</h2>
      <p class="text-sm text-gray-500 mb-4">${escapeHtml(member.email)}</p>
      <p class="text-gray-500">No feedback submitted yet.</p>`;
    return;
  }
  detail.className = 'space-y-4';
  detail.innerHTML = `
    <div>
      <h2 class="text-xl font-semibold">${escapeHtml(member.name)}</h2>
      <p class="text-sm text-gray-500">${escapeHtml(member.email)} &bull; ${member.responses.length} response${member.responses.length === 1 ? '' : 's'}</p>
    </div>
    ${member.responses.map((r, index) => `
      <details class="card" ${index === 0 ? 'open' : ''}>
        <summary class="cursor-pointer font-semibold">
          Submitted ${formatTime(r.created_at)}
        </summary>
        <dl class="mt-4 space-y-4 text-sm">
          ${r.answers.map(a => `
            <div>
              <dt class="font-medium text-gray-800">${escapeHtml(a.question)}</dt>
              <dd class="text-gray-600 whitespace-pre-wrap mt-1">${a.answer ? escapeHtml(a.answer) : '<span class="text-gray-400">No answer</span>'}</dd>
            </div>`).join('')}
        </dl>
      </details>`).join('')}`;
}
