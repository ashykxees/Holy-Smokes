// The event name, date, shifts, and volunteer limits are set in backend/volunteer_event.json.

function onAuthReady(user) {
  loadVolunteerEvent();
}

function volunteersNeededText(slot) {
  if (slot.min_volunteers === slot.max_volunteers) {
    return `${slot.max_volunteers} volunteers needed`;
  }
  return `${slot.min_volunteers}-${slot.max_volunteers} volunteers needed`;
}

function slotHtml(slot) {
  const count = slot.volunteers.length;
  const full = count >= slot.max_volunteers;
  const names = count
    ? slot.volunteers.map(name => `<li>${escapeHtml(name)}</li>`).join('')
    : '<li class="text-gray-400">No one yet</li>';

  let button;
  if (slot.signed_up) {
    button = `<button onclick="cancelSignup('${slot.id}')" class="w-full border border-red-300 text-red-600 rounded-lg px-4 py-2 hover:bg-red-50">Cancel My Sign Up</button>`;
  } else if (full) {
    button = '<button disabled class="w-full bg-gray-200 text-gray-500 rounded-lg px-4 py-2 cursor-not-allowed">Shift Full</button>';
  } else {
    button = `<button onclick="signUp('${slot.id}')" class="btn-primary w-full">Sign Up</button>`;
  }

  return `
    <div class="card flex flex-col">
      <div class="text-2xl font-bold">${escapeHtml(slot.time)}</div>
      <div class="text-gray-600">${escapeHtml(slot.location)}</div>
      <div class="text-sm text-green-700 font-medium mt-2">${volunteersNeededText(slot)}</div>
      <div class="text-sm text-gray-500 mt-1">${count} / ${slot.max_volunteers} signed up</div>
      <div class="mt-4 mb-4 flex-1">
        <div class="text-xs uppercase tracking-widest text-gray-400 mb-1">Volunteers</div>
        <ul class="text-sm space-y-1">${names}</ul>
      </div>
      ${slot.signed_up ? '<div class="text-sm text-green-700 font-semibold mb-2">You are signed up for this shift.</div>' : ''}
      ${button}
    </div>`;
}

async function loadVolunteerEvent() {
  const container = document.getElementById('slots');
  try {
    const event = await fetchJSON('/api/volunteer');
    if (!event) return;
    document.title = `${event.title} | Holy Smokes`;
    document.getElementById('event-title').textContent = event.title;
    document.getElementById('event-description').textContent = event.description || '';
    document.getElementById('event-date').textContent = event.date
      ? new Date(event.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : '';
    container.innerHTML = event.slots.map(slotHtml).join('');
  } catch (err) {
    container.innerHTML = `<div class="text-red-600 text-sm">${escapeHtml(err.message)}</div>`;
  }
}

async function signUp(slotId) {
  try {
    await fetchJSON(`/api/volunteer/${encodeURIComponent(slotId)}`, { method: 'POST' });
  } catch (err) {
    alert(err.message);
  }
  loadVolunteerEvent();
}

async function cancelSignup(slotId) {
  if (!confirm('Cancel your sign up for this shift?')) return;
  try {
    await fetchJSON(`/api/volunteer/${encodeURIComponent(slotId)}`, { method: 'DELETE' });
  } catch (err) {
    alert(err.message);
  }
  loadVolunteerEvent();
}
