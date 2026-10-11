// Where each hero slideshow photo is anchored so faces stay in the frame.
// Format: "file name": "<left-right %> <top-bottom %>"
//   0% = left/top edge of the photo, 50% = center, 100% = right/bottom edge.
// Faces cut off at the top? Lower the second number. Cut off at the bottom? Raise it.
// Photos not listed here use HERO_FOCUS_DEFAULT.
const HERO_FOCUS_DEFAULT = "50% 25%";

const HERO_FOCUS = {
  "hero1.jpg": "50% 26%",
  "hero2.jpg": "50% 26%",
  "hero3.jpg": "50% 20%",
  "hero4.jpg": "35% 13%",
  "hero5.jpg": "50% 0%",
  "hero6.jpg": "50% 26%",
  "hero7.jpg": "50% 38%",
  "hero8.jpg": "50% 0%",
  "hero9.jpg": "50% 15%",
  "hero10.jpg": "50% 30%",
};
