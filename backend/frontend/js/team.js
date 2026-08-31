async function onAuthReady(user) {
  if (!user) return;
  currentUser = user;
  const managerCard = document.getElementById('manager-card');
  const teammatesList = document.getElementById('teammates-list');
  const fullTeamList = document.getElementById('full-team-list');

  try {
    const users = await fetchJSON('/api/users');
    if (!users || !users.length) {
      managerCard.innerHTML = '<p class="text-gray-500">No team members yet.</p>';
      teammatesList.innerHTML = '';
      fullTeamList.innerHTML = '';
      return;
    }

    const myTeam = currentUser.team_number;
    const manager = myTeam
      ? users.find(u => u.team_number === myTeam && u.is_manager && u.email !== currentUser.email)
      : null;

    managerCard.innerHTML = renderManager(manager, myTeam);
    teammatesList.innerHTML = renderTeammates(users, myTeam);
    fullTeamList.innerHTML = users
      .slice()
      .sort((a, b) => (a.team_number || 99) - (b.team_number || 99) || a.name.localeCompare(b.name))
      .map(u => renderUserRow(u))
      .join('');
  } catch (err) {
    document.getElementById('manager-card').innerHTML = `<p class="text-red-600">${escapeHtml(err.message)}</p>`;
  }
}

function renderManager(manager, teamNumber) {
  if (!teamNumber) {
    return '<p class="text-gray-500">You are not assigned to a team yet.</p>';
  }
  if (currentUser.is_manager) {
    return renderUserRow(currentUser, `You are the Team ${teamNumber} Leader`);
  }
  if (!manager) {
    return `<p class="text-gray-500">No Team ${teamNumber} manager assigned yet.</p>`;
  }
  return renderUserRow(manager, `Team ${teamNumber} Manager`);
}

function renderTeammates(users, teamNumber) {
  const teammates = users.filter(
    u => u.team_number === teamNumber && u.email !== currentUser.email && !u.is_manager && !u.is_owner
  );
  if (!teamNumber) {
    return '<p class="text-gray-500 p-4">Join a team to see your teammates here.</p>';
  }
  if (!teammates.length) {
    return `<p class="text-gray-500 p-4">No other members on Team ${teamNumber} yet.</p>`;
  }
  return teammates
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(u => renderUserRow(u))
    .join('');
}

function renderUserRow(u, subtitle) {
  return `
    <div class="flex items-center gap-4 p-4">
      ${avatar(u)}
      <div class="flex-1 min-w-0">
        <div class="font-medium truncate">
          ${escapeHtml(u.name)}
          ${renderBadges(u)}
        </div>
        ${subtitle ? `<div class="text-sm text-gray-500 truncate">${escapeHtml(subtitle)}</div>` : ''}
        <div class="text-sm text-gray-500 truncate">${escapeHtml(u.dc_email || u.email)}${u.nickname ? ` &middot; ${escapeHtml(u.nickname)}` : ''}</div>
        ${u.phone ? `<div class="text-xs text-gray-400">${escapeHtml(u.phone)}</div>` : ''}
      </div>
    </div>
  `;
}

function avatar(u) {
  if (u.picture) {
    return `<img src="${escapeHtml(u.picture)}" alt="" class="w-12 h-12 rounded-full object-cover border border-gray-200">`;
  }
  return `<div class="w-12 h-12 rounded-full bg-hs-green text-white flex items-center justify-center font-bold">${escapeHtml((u.name || 'U').charAt(0).toUpperCase())}</div>`;
}

function renderBadges(u) {
  const badges = [];
  if (u.is_owner) {
    badges.push(badge('Owner', 'bg-black text-white'));
  } else if (u.is_manager) {
    badges.push(badge('Management', 'bg-green-100 text-green-800'));
  }
  if (u.is_dc_employee) {
    badges.push(badge('Advisor', 'bg-blue-100 text-blue-800'));
  }
  if (u.is_manager && u.team_number) {
    badges.push(badge(`Team ${u.team_number} Leader`, 'bg-yellow-100 text-yellow-800'));
  } else if (u.team_number) {
    badges.push(badge(`Team ${u.team_number}`, 'bg-gray-100 text-gray-800'));
  }
  return badges.join('');
}

function badge(text, colorClass) {
  return `<span class="ml-2 text-xs px-2 py-0.5 rounded-full ${colorClass}">${escapeHtml(text)}</span>`;
}

window.onAuthReady = onAuthReady;
