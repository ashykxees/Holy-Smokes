window.onAuthReady = async (user) => {
  if (!user || !user.is_manager) {
    window.location.href = '/dashboard';
    return;
  }
  loadRequests();
};

async function loadRequests() {
  const container = document.getElementById('requests-list');
  try {
    const requests = await fetchJSON('/api/catering/requests');
    if (!requests || requests.length === 0) {
      container.innerHTML = '<p class="text-gray-500 text-center py-8">No catering requests yet.</p>';
      return;
    }
    container.innerHTML = requests.map(r => `
      <div class="border border-gray-200 rounded-lg p-4 bg-white">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3">
          <div>
            <h3 class="font-semibold text-lg">${escapeHtml(r.name)}</h3>
            <p class="text-sm text-gray-600">${escapeHtml(r.phone)} &bull; ${escapeHtml(r.event_type)} &bull; ${r.guests} guests &bull; ${escapeHtml(r.event_date)}</p>
          </div>
          <div class="flex items-center gap-3">
            ${r.email_sent ? '<span class="inline-flex items-center rounded-full bg-green-100 text-hs-green text-xs font-bold px-3 py-1">Email sent</span>' : '<span class="inline-flex items-center rounded-full bg-yellow-100 text-yellow-800 text-xs font-bold px-3 py-1">Email pending</span>'}
            <button onclick="deleteRequest(${r.id})" class="text-sm text-red-600 hover:text-red-800 font-medium">Delete</button>
          </div>
        </div>
        <div class="text-sm text-gray-700 mb-2">
          <span class="font-semibold">Requested items:</span> ${escapeHtml((r.items || []).join(', '))}
        </div>
        ${r.description ? `<div class="text-sm text-gray-700 bg-gray-50 rounded-lg p-3"><p class="font-semibold mb-1">Description:</p>${escapeHtml(r.description)}</div>` : ''}
        <div class="text-xs text-gray-400 mt-3">Submitted ${formatTime(r.created_at)}</div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<p class="text-red-600 text-center py-8">${escapeHtml(err.message)}</p>`;
  }
}

async function deleteRequest(id) {
  if (!confirm('Delete this catering request?')) return;
  try {
    await fetchJSON(`/api/catering/requests/${id}`, { method: 'DELETE' });
    loadRequests();
  } catch (err) {
    alert(err.message || 'Failed to delete request');
  }
}
