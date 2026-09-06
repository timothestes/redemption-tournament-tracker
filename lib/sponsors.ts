// Single source of truth for the site's sponsors. The footer on most pages and
// the /sponsors page both render from this list, so adding or changing a
// sponsor here updates every surface at once.

export type Sponsor = {
  name: string;
  href: string;
  /** Hostname shown as the visible link text on /sponsors. */
  site: string;
  /** One or two plain sentences: who they are and what they do for the site. */
  blurb: string;
  logoDark: string;
  logoLight: string;
  width: number;
  height: number;
};

export const SPONSORS: Sponsor[] = [
  {
    name: "Your Turn Games",
    href: "https://www.yourturngames.biz",
    site: "yourturngames.biz",
    blurb:
      "Your Turn Games is an online game store that carries Redemption singles and decks. The card prices shown in the deck builder and the collection tracker come from their catalog.",
    logoDark: "/sponsors/ytg-dark.png",
    logoLight: "/sponsors/ytg-light.png",
    width: 100,
    height: 100,
  },
];
