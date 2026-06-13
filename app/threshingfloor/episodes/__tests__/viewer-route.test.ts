import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc })),
}));
vi.mock("fs/promises", () => ({
  readFile: vi.fn(async () => "<head></head><script>main();</script>"),
}));

import { GET } from "../[episode]/route";

const ctx = (episode: string) => ({ params: Promise.resolve({ episode }) });
const req = () => new Request("http://x/threshingfloor/episodes/100");

beforeEach(() => vi.clearAllMocks());

describe("GET /threshingfloor/episodes/[episode]", () => {
  it("404s when the episode is not published (function returns null)", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await GET(req(), ctx("100"));
    expect(r.status).toBe(404);
  });

  it("404s on an invalid episode segment", async () => {
    const r = await GET(req(), ctx("%20%20"));
    expect(r.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("serves the outline with injected snapshot + noindex header when published", async () => {
    rpc.mockResolvedValue({ data: { "ep-num": "100" }, error: null });
    const r = await GET(req(), ctx("100"));
    expect(r.status).toBe(200);
    expect(r.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const body = await r.text();
    expect(body).toContain("window.__TF_VIEW__");
    expect(body.indexOf("window.__TF_VIEW__")).toBeLessThan(body.indexOf("main();"));
  });
});
