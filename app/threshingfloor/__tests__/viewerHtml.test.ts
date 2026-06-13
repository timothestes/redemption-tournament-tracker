import { describe, it, expect } from "vitest";
import { buildViewerHtml, escapeForScript } from "../viewerHtml";

describe("escapeForScript", () => {
  it("escapes characters that could break out of a <script> tag", () => {
    const out = escapeForScript('</script><x>&  ');
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<x>");
    expect(out).toContain("\\u003c"); // <
    expect(out).toContain("\\u003e"); // >
    expect(out).toContain("\\u0026"); // &
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
  });
  it("produces valid JSON that round-trips", () => {
    const value = { a: "</script>", b: [1, 2], c: "x & y" };
    const parsed = JSON.parse(escapeForScript(value).replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u0026/g, "&"));
    expect(parsed).toEqual(value);
  });
});

describe("buildViewerHtml", () => {
  const shell = "<head></head><script>main();</script>";
  it("injects the bootstrap before the first <script> tag", () => {
    const out = buildViewerHtml(shell, "100", { "ep-num": "100" });
    expect(out.indexOf("window.__TF_VIEW__")).toBeLessThan(out.indexOf("main();"));
    expect(out).toContain('"episode"');
  });
  it("does not let snapshot content break out of the bootstrap script", () => {
    const out = buildViewerHtml(shell, "100", { evil: "</script><img src=x onerror=alert(1)>" });
    // the literal closing tag from the payload must not appear; only the real one
    expect(out.match(/<\/script>/g)!.length).toBe(2);
  });
  it("returns the shell unchanged except for the injected tag", () => {
    const out = buildViewerHtml(shell, "100", {});
    expect(out).toContain("<head></head>");
    expect(out).toContain("main();");
  });
});
