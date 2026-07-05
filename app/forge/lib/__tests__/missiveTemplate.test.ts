import { describe, it, expect } from "vitest";
import { escapeHtml, missiveBodyHtml, wrapForgeMissive } from "../missiveTemplate";

describe("escapeHtml", () => {
  it("escapes angle brackets, ampersands, and quotes", () => {
    expect(escapeHtml("<script>alert('x')</script>")).toBe(
      "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;",
    );
    expect(escapeHtml("a & b")).toBe("a &amp; b");
    expect(escapeHtml('say "hi"')).toBe("say &quot;hi&quot;");
  });
});

describe("missiveBodyHtml", () => {
  it("substitutes {name}, splits blank-line blocks into <p>, and drops raw {name}", () => {
    const html = missiveBodyHtml("Hi {name},\n\nRound two begins.", "Ada");
    expect(html).toContain("Hi Ada,");
    expect(html).not.toContain("{name}");
    const pCount = (html.match(/<p/g) || []).length;
    expect(pCount).toBe(2);
  });

  it("escapes a recipient name containing HTML", () => {
    const html = missiveBodyHtml("Hi {name}", "<b>x</b>");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("converts a single newline within a block to <br>", () => {
    expect(missiveBodyHtml("a\nb", "x")).toContain("a<br>b");
  });
});

describe("wrapForgeMissive", () => {
  const out = wrapForgeMissive({
    bodyHtml: missiveBodyHtml("Hi {name},\n\nWelcome.", "Ada"),
    senderName: "Tim",
    senderEmail: "tim@example.com",
  });

  it("contains the body html, wordmark, sender name/email, and both block copies", () => {
    expect(out).toContain("Hi Ada,");
    expect(out).toContain("THE FORGE");
    expect(out).toContain("Tim");
    expect(out).toContain("tim@example.com");
    expect(out).toContain("confidential playtest material");
    expect(out).toContain("DM");
    expect(out).toContain("Discord");
  });

  it("does not leak the {name} placeholder", () => {
    expect(out).not.toContain("{name}");
  });

  it("escapes a malicious senderName", () => {
    const evil = wrapForgeMissive({
      bodyHtml: "<p>hi</p>",
      senderName: '<img src=x onerror=alert(1)>',
      senderEmail: "tim@example.com",
    });
    expect(evil).not.toContain("<img");
    expect(evil).toContain("&lt;img");
  });
});
