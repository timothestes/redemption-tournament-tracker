import { describe, expect, it } from "vitest";
import { resolveAuthors, serviceClient } from "../db";

const users = [{ id: "u-tim", email: "baboonytim@gmail.com" }, { id: "u-rob", email: "robmulye@gmail.com" }];
const map = [
  { login: "TimE", name: "BaboonyTim", email: "baboonytim@gmail.com" },
  { login: "RobM", name: "RobM", email: "robmulye@gmail.com" },
  { login: "admin", name: "Gabe", email: null },
];

describe("resolveAuthors", () => {
  it("maps emails to ids and null emails to the archive", () => {
    const r = resolveAuthors(map, users, "u-archive");
    expect(r.get("TimE")).toBe("u-tim");
    expect(r.get("RobM")).toBe("u-rob");
    expect(r.get("admin")).toBe("u-archive");
  });
  it("throws naming every unresolved mapped email", () => {
    expect(() => resolveAuthors([...map, { login: "X", name: "X", email: "nobody@example.com" }, { login: "Y", name: "Y", email: "ghost@example.com" }], users, "a")).toThrow(/nobody@example.com.*ghost@example.com|ghost@example.com.*nobody@example.com/s);
  });
});

describe("serviceClient", () => {
  it("requires the url and service role key", () => {
    expect(() => serviceClient({})).toThrow(/SUPABASE/);
    expect(serviceClient({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" })).toBeTruthy();
  });
});
