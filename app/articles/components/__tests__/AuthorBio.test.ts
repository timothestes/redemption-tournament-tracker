import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AuthorBio from "../AuthorBio";

type Author = { username: string | null; avatar_url: string | null; bio: string | null } | null;

const render = (author: Author, author_name: string | null = null) =>
  renderToStaticMarkup(createElement(AuthorBio, { post: { author_name, author } }));

describe("AuthorBio", () => {
  it("renders nothing when the author has no avatar and no bio", () => {
    expect(render({ username: "tim", avatar_url: null, bio: null })).toBe("");
  });

  it("renders nothing for a null author (e.g. an imported post)", () => {
    expect(render(null)).toBe("");
  });

  it("renders the bio and a fallback initial when there's no avatar", () => {
    const html = render({ username: "tim", avatar_url: null, bio: "I play Genesis." });
    expect(html).toContain("I play Genesis.");
    expect(html).toContain(">T<");
  });

  it("renders the avatar image when present", () => {
    const html = render({ username: "tim", avatar_url: "https://x/avatar.png", bio: null });
    expect(html).toContain('src="https://x/avatar.png"');
  });

  it("uses the author_name byline override in the About heading, not the raw username", () => {
    const html = render({ username: "timestes", avatar_url: null, bio: "I play Genesis." }, "Tim Estes");
    expect(html).toContain("About Tim Estes");
    expect(html).not.toContain("About timestes");
  });
});
