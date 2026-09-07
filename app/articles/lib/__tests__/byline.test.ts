import { describe, expect, it } from "vitest";
import { postByline } from "../queries";

describe("postByline", () => {
  it("prefers author_name over the profile username", () => {
    expect(postByline({ author_name: "Tyler Stevens", author: { username: "tstevens", avatar_url: null, bio: null } })).toBe("Tyler Stevens");
  });
  it("falls back to the username", () => {
    expect(postByline({ author_name: null, author: { username: "TimE", avatar_url: null, bio: null } })).toBe("TimE");
  });
  it("falls back to the site name when both are missing", () => {
    expect(postByline({ author_name: null, author: { username: null, avatar_url: null, bio: null } })).toBe("Land of Redemption");
    expect(postByline({ author_name: null, author: null })).toBe("Land of Redemption");
  });
});
