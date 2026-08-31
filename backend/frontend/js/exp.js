function onAuthReady(user) {
  loadLeaderboard(user);
}

async function loadLeaderboard(currentUser) {
  const list = document.getElementById('leaderboard');
  const status = document.getElementById('user-status');
  try {
    const users = await fetchJSON('/api/exp/leaderboard');
    if (!users.length) {
      list.innerHTML = '<li class="text-gray-500 text-sm p-2">No users on the leaderboard yet.</li>';
      status.innerHTML = '<div class="font-medium">No rankings yet.</div>';
      return;
    }

    const current = users.find(u => u.email === currentUser.email) || { rank: '—', exp_total: 0 };
    const rankText = typeof current.rank === 'number' ? ordinal(current.rank) : current.rank;
    status.innerHTML = `
      <div class="font-medium">
        You have ${current.exp_total || 0} EXP. | ${rankText} Place, keep up the good work
      </div>
      <div class="text-4xl font-bold opacity-20">#${current.rank || '—'}</div>
    `;

    const top3Class = [
      'bg-yellow-50 border-yellow-200 text-yellow-700',
      'bg-gray-50 border-gray-200 text-gray-600',
      'bg-amber-50 border-amber-200 text-amber-800',
    ];

    list.innerHTML = users.map((u, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${u.rank}`;
      const topClass = i < 3 ? top3Class[i] : 'bg-white border-gray-100';
      const isCurrent = u.email === currentUser.email ? 'ring-2 ring-hs-green' : '';
      return `
        <li class="flex items-center gap-4 p-4 rounded-lg border ${topClass} ${isCurrent}">
          <div class="text-2xl font-bold w-10 text-center">${medal}</div>
          <div class="flex-1">
            <div class="font-semibold">${escapeHtml(u.name)}</div>
            ${isCurrent ? '<div class="text-xs opacity-80">You</div>' : ''}
          </div>
          <div class="font-bold text-lg">${u.exp_total || 0} EXP</div>
        </li>
      `;
    }).join('');
  } catch (err) {
    list.innerHTML = `<li class="text-red-500 text-sm p-2">${err.message}</li>`;
    status.innerHTML = '<div class="font-medium">Could not load EXP.</div>';
  }
}

function ordinal(n) {
  if (!n && n !== 0) return '—';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

window.onAuthReady = onAuthReady;
