// ============================================================
//  UPCOMING EVENTS — edit this list to update the /events page.
//  date: "YYYY-MM-DD"   time: any text (or "" to hide)
//  link: optional URL for a "Learn more" button (or "")
//  Past events are hidden automatically.
// ============================================================
const EVENTS = [
  {
    title: "Homecoming Football Game",
    date: "2026-10-09",
    time: "Game Night",
    location: "Glen Mills School",
    description: "We're serving Holy Smokes BBQ at the homecoming game. Limited stock — come early!",
  },
  {
    title: "Homecoming Showcase",
    date: "2026-10-10",
    time: "12:00 PM – 2:00 PM",
    location: "DC Softball Field",
    description: "Free samples and info about Holy Smokes. Stop by and meet the team.",
  },
  {
    title: "Freshman Social",
    date: "2026-10-22",
    time: "5:30",
    location: "Delaware County Christian School",
    description: "We're catering the Freshman class' social!",
  },
];
// ============================================================

(function renderEvents() {
  const list = document.getElementById('events-list');
  const empty = document.getElementById('events-empty');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcoming = EVENTS
    .map(e => ({ ...e, _date: new Date(e.date + 'T00:00:00') }))
    .filter(e => e._date >= today)
    .sort((a, b) => a._date - b._date);

  if (!upcoming.length) {
    empty.classList.remove('hidden');
    return;
  }

  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  list.innerHTML = upcoming.map(e => {
    const month = e._date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    const day = e._date.getDate();
    const weekday = e._date.toLocaleDateString('en-US', { weekday: 'long' });
    const meta = [weekday, e.time, e.location].filter(Boolean).map(esc).join(' &bull; ');
    return `
      <div class="card flex flex-col sm:flex-row gap-6 items-start">
        <div class="shrink-0 w-20 text-center rounded-lg bg-hs-green text-white py-3">
          <div class="text-xs font-bold tracking-widest">${month}</div>
          <div class="text-3xl font-display leading-none mt-1">${day}</div>
        </div>
        <div class="flex-1">
          <h2 class="text-2xl font-display mb-1">${esc(e.title)}</h2>
          <p class="text-sm text-hs-green font-semibold mb-3">${meta}</p>
          ${e.description ? `<p class="text-gray-700 leading-relaxed">${esc(e.description)}</p>` : ''}
          ${e.link ? `<a href="${esc(e.link)}" class="inline-block mt-4 text-hs-green font-semibold hover:underline">Learn more &rarr;</a>` : ''}
        </div>
      </div>`;
  }).join('');
})();
