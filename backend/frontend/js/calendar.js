let currentDate = new Date();
let calendarData = { events: [], tasks: [] };

async function onAuthReady(user) {
  try {
    calendarData = await fetchJSON('/api/calendar') || { events: [], tasks: [] };
  } catch (err) {
    calendarData = { events: [], tasks: [] };
  }
  renderCalendar(currentDate);
}

function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isToday(d) {
  return toISODate(d) === toISODate(new Date());
}

function changeMonth(offset) {
  currentDate.setMonth(currentDate.getMonth() + offset);
  currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  renderCalendar(currentDate);
}

function renderCalendar(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  document.getElementById('month-label').textContent = date.toLocaleString('default', { month: 'long', year: 'numeric' });
  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  for (let i = 0; i < firstDay; i++) {
    grid.appendChild(emptyCell());
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(year, month, day);
    const iso = toISODate(cellDate);
    const cell = document.createElement('div');
    cell.className = 'min-h-[80px] md:min-h-[100px] border border-gray-100 rounded-lg p-2 flex flex-col gap-1 hover:bg-gray-50 cursor-pointer';

    const header = document.createElement('div');
    header.className = `text-sm font-medium ${isToday(cellDate) ? 'text-hs-green font-bold' : ''}`;
    header.textContent = day;
    cell.appendChild(header);

    const dayEvents = (calendarData.events || []).filter(e => e.event_date === iso);
    const dayTasks = (calendarData.tasks || []).filter(t => t.due_date === iso);
    const items = [...dayEvents, ...dayTasks];

    if (items.length) {
      const dots = document.createElement('div');
      dots.className = 'flex flex-wrap gap-1 mt-auto';
      items.forEach(item => {
        const span = document.createElement('span');
        span.className = `text-[10px] truncate px-1.5 py-0.5 rounded ${item.event_date ? 'bg-hs-green text-white' : 'bg-yellow-100 text-yellow-800'}`;
        span.textContent = item.title;
        span.title = item.title;
        dots.appendChild(span);
      });
      cell.appendChild(dots);
    }

    cell.onclick = () => showDay(iso, items);
    grid.appendChild(cell);
  }

  const totalCells = firstDay + daysInMonth;
  const remainder = totalCells % 7;
  const pad = remainder ? 7 - remainder : 0;
  for (let i = 0; i < pad; i++) {
    grid.appendChild(emptyCell());
  }
}

function emptyCell() {
  const div = document.createElement('div');
  div.className = 'min-h-[80px] md:min-h-[100px]';
  return div;
}

function showDay(iso, items) {
  document.getElementById('selected-date').textContent = new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const list = document.getElementById('day-items');
  if (!items.length) {
    list.innerHTML = '<li class="text-gray-500 text-sm">No events or due tasks.</li>';
    return;
  }

  items.sort((a, b) => (a.event_time || '23:59').localeCompare(b.event_time || '23:59'));

  list.innerHTML = items.map(item => {
    const isEvent = 'event_date' in item;
    const time = isEvent ? item.event_time : item.due_time;
    const badge = isEvent
      ? '<span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-hs-green text-white">Event</span>'
      : `<span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800">+${item.exp || 0} EXP</span>`;
    const gcalLink = googleCalendarLink(item, isEvent ? 'event' : 'task');
    const meta = isEvent
      ? (time ? `at ${time}` : 'All day')
      : `Due ${time ? 'at ' + time : 'all day'}${item.assigned_to === 'all' ? ' · Entire Team' : ' · ' + escapeHtml(item.assigned_to)}`;
    return `
      <li class="p-4 border border-gray-100 rounded-lg bg-white">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-1">
              <div class="font-semibold">${escapeHtml(item.title)}</div>
              ${badge}
            </div>
            <div class="text-sm text-gray-500 mb-2">${escapeHtml(meta)}</div>
            ${item.description ? `<div class="text-sm text-gray-700 whitespace-pre-wrap">${escapeHtml(item.description)}</div>` : ''}
          </div>
          <a href="${gcalLink}" target="_blank" rel="noopener" class="btn-secondary text-xs whitespace-nowrap">Add to Google Calendar</a>
        </div>
      </li>
    `;
  }).join('');
}

function googleCalendarLink(item, type) {
  const title = encodeURIComponent(item.title);
  const details = encodeURIComponent(item.description || '');
  if (type === 'event' && item.event_time) {
    const [hour, minute] = item.event_time.split(':').map(Number);
    const start = new Date(`${item.event_date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&dates=${fmt(start)}/${fmt(end)}`;
  }
  const date = item.event_date || item.due_date;
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&dates=${fmt(start)}/${fmt(end)}`;
}

window.onAuthReady = onAuthReady;
