// How each hero slideshow photo is framed in the homepage banner.
// position: "<left-right %> <top-bottom %>" of the photo to keep in view.
//   0% = left/top edge, 50% = center, 100% = right/bottom edge.
// show: how much of the photo's height stays visible (0.5 = half, 1 = the whole photo).
//   Raise it to zoom out and show more of what people are doing; lower it to zoom in.
//   Any empty space at the sides is filled with a blurred copy of the photo.
// Photos not listed here use HERO_FOCUS_DEFAULT.
const HERO_FOCUS_DEFAULT = { position: "50% 35%", show: 0.75 };

const HERO_FOCUS = {
  "hero1.jpg": { position: "50% 30%", show: 0.75 },
  "hero2.jpg": { position: "50% 40%", show: 0.75 },
  "hero3.jpg": { position: "50% 50%", show: 0.75 },
  "hero4.jpg": { position: "50% 40%", show: 0.75 },
  "hero5.jpg": { position: "50% 30%", show: 0.75 },
  "hero6.jpg": { position: "50% 45%", show: 0.7 },
  "hero7.jpg": { position: "50% 70%", show: 0.6 },
  "hero8.jpg": { position: "50% 35%", show: 0.8 },
  "hero9.jpg": { position: "50% 40%", show: 0.75 },
  "hero10.jpg": { position: "50% 40%", show: 0.75 },
};
