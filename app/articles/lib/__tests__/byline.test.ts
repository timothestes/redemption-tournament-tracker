import { describe, expect, it } from "vitest";
import { postByline } from "../queries";

describe("postByline", () => {
  it("prefers author_name over the profile username", () => {
    expect(postByline({ author_name: "Tyler Stevens", author: { username: "tstevens" } })).toBe("Tyler Stevens");
  });
  it("falls back to the username", () => {
    expect(postByline({ author_name: null, author: { username: "TimE" } })).toBe("TimE");
  });
  it("falls back to the site name when both are missing", () => {
    expect(postByline({ author_name: null, author: { username: null } })).toBe("Land of Redemption");
    expect(postByline({ author_name: null, author: null })).toBe("Land of Redemption");
  });
});
