// ============================================================
//  SPONSORS — edit this list to update the /sponsors page.
//  title: the sponsor's role, shown above their name
//  logo: an image in /assets
//  logoBackground: color behind the logo
//  link: the sponsor's website or Instagram
// ============================================================
const SPONSORS = [
  {
    title: "Founding Innovation Partner",
    name: "DC's Innovation Center",
    logo: "/assets/sponsor-dc-innovation.jpg",
    logoBackground: "#ffffff",
    link: "https://www.instagram.com/dcinnovation_/",
    linkLabel: "@dcinnovation_ on Instagram",
    description: "DC's Innovation Center helped launch Holy Smokes and supports our students as they build the team.",
  },
  {
    title: "Firewood Sponsor",
    name: "LeBoon's Tree Service",
    logo: "/assets/sponsor-leboon.png",
    logoBackground: "#1a1a1a",
    link: "https://www.leboonstreeservice.com/",
    linkLabel: "leboonstreeservice.com",
    description: "LeBoon's Tree Service supplies the firewood that keeps our smokers burning.",
  },
  {
    title: "Strategic Partner",
    name: "JT Wilder BBQ",
    logo: "/assets/sponsor-jt-wilder.png",
    logoBackground: "#231f20",
    link: "https://www.instagram.com/jtwilderbbq/",
    linkLabel: "@jtwilderbbq on Instagram",
    description: "JT Wilder BBQ shares their pitmaster experience and helps our team grow.",
  },
];
// ============================================================

(function renderSponsors() {
  const list = document.getElementById('sponsors-list');

  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

  list.innerHTML = SPONSORS.map(s => `
    <div class="card flex flex-col md:flex-row gap-6 md:gap-8 items-center">
      <a href="${esc(s.link)}" target="_blank" rel="noopener"
         class="shrink-0 w-48 h-48 rounded-xl border border-gray-200 flex items-center justify-center overflow-hidden"
         style="background-color: ${esc(s.logoBackground)}">
        <img src="${esc(s.logo)}" alt="${esc(s.name)} logo" class="max-w-full max-h-full object-contain">
      </a>
      <div class="flex-1 text-center md:text-left">
        <p class="uppercase tracking-[0.2em] text-hs-green text-xs font-bold mb-2">${esc(s.title)}</p>
        <h2 class="text-3xl font-display mb-3">${esc(s.name)}</h2>
        <p class="text-gray-700 leading-relaxed mb-4">${esc(s.description)}</p>
        <a href="${esc(s.link)}" target="_blank" rel="noopener"
           class="inline-block text-hs-green font-semibold hover:underline">
          ${esc(s.linkLabel || 'Visit')} &rarr;
        </a>
      </div>
    </div>`).join('');
})();
