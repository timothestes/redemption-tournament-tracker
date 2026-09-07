import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AuthorBio from "../AuthorBio";

const render = (author: { username: string | null; avatar_url: string | null; bio: string | null } | null) =>
  renderToStaticMarkup(createElement(AuthorBio, { author }));

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
});
