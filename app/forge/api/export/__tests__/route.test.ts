import { describe, it, expect, vi, beforeEach } from "vitest";
import { unzipSync, strFromU8 } from "fflate";

vi.mock("@/app/forge/lib/auth", () => ({
  requireForge: vi.fn(),
  notFoundResponse: () => new Response("Not Found", { status: 404 }),
}));
vi.mock("@/app/forge/lib/sets", () => ({ getSet: vi.fn() }));
vi.mock("@/app/forge/lib/setArtwork", async () => {
  const actual = await vi.importActual<typeof import("@/app/forge/lib/setArtwork")>(
    "@/app/forge/lib/setArtwork",
  );
  return { ...actual, listSetWorkingCards: vi.fn() };
});
vi.mock("@/app/forge/lib/art", () => ({ readForgeArt: vi.fn() }));

import { GET } from "@/app/forge/api/export/route";
import { requireForge } from "@/app/forge/lib/auth";
import { getSet } from "@/app/forge/lib/sets";
import { listSetWorkingCards } from "@/app/forge/lib/setArtwork";
import { readForgeArt } from "@/app/forge/lib/art";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function reqWith(ids: string) {
  return new Request(`http://localhost/forge/api/export?ids=${ids}`);
}

describe("GET /forge/api/export", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the caller is not a Forge member", async () => {
    asMock(requireForge).mockResolvedValue(null);
    const res = await GET(reqWith("s1"));
    expect(res.status).toBe(404);
    expect(getSet).not.toHaveBeenCalled();
  });

  it("returns 404 when no ids are given", async () => {
    asMock(requireForge).mockResolvedValue({ supabase: {}, user: { id: "u1" }, role: "elder" });
    const res = await GET(reqWith(""));
    expect(res.status).toBe(404);
  });

  it("returns 404 when the only selected set has no readable cards", async () => {
    asMock(requireForge).mockResolvedValue({ supabase: {}, user: { id: "u1" }, role: "elder" });
    asMock(getSet).mockResolvedValue({ id: "s1", name: "Test Set", slug: "TST" });
    asMock(listSetWorkingCards).mockResolvedValue([]);
    const res = await GET(reqWith("s1"));
    expect(res.status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });

  it("builds a zip with carddata.txt, setlist.txt and the finished image", async () => {
    asMock(requireForge).mockResolvedValue({ supabase: {}, user: { id: "u1" }, role: "elder" });
    asMock(getSet).mockResolvedValue({ id: "s1", name: "End of Time", slug: "EoT" });
    asMock(listSetWorkingCards).mockResolvedValue([
      {
        cardId: "c1", title: "Alpha and Omega", finishedKey: "forge-finished/x",
        snapshot: { cardType: ["Dominant"], alignment: "Good", rawText: "Do a thing." },
      },
      {
        cardId: "c2", title: "No Image Card", finishedKey: null,
        snapshot: { cardType: ["GE"], brigades: ["White"] },
      },
    ]);
    asMock(readForgeArt).mockResolvedValue({
      statusCode: 200,
      stream: new Response(new Uint8Array([1, 2, 3])).body,
      blob: { contentType: "image/jpeg" },
    });

    const res = await GET(reqWith("s1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain("end-of-time-forge-export.zip");

    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(entries)).toContain("sets/carddata.txt");
    expect(Object.keys(entries)).toContain("sets/setlist.txt");
    expect(Object.keys(entries)).toContain("sets/setimages/general/Alpha-and-Omega.jpg");

    const carddata = strFromU8(entries["sets/carddata.txt"]);
    expect(carddata.split("\n")[0]).toContain("Name\tSet\tImageFile");
    expect(carddata).toContain("Alpha and Omega\tEoT\tAlpha-and-Omega");
    expect(carddata).toContain("No Image Card"); // row present even without an image
    expect(strFromU8(entries["sets/setlist.txt"]).trim()).toBe("End of Time");
  });

  it("skips a set the caller can't read (getSet null) but exports the readable one", async () => {
    asMock(requireForge).mockResolvedValue({ supabase: {}, user: { id: "u1" }, role: "elder" });
    asMock(getSet).mockImplementation(async (id: string) =>
      id === "ok" ? { id: "ok", name: "Readable", slug: "RD" } : null,
    );
    asMock(listSetWorkingCards).mockResolvedValue([
      { cardId: "c1", title: "Card One", finishedKey: null, snapshot: { cardType: ["Hero"] } },
    ]);

    const res = await GET(reqWith("secret,ok"));
    expect(res.status).toBe(200);
    // listSetWorkingCards only called for the readable set.
    expect(listSetWorkingCards).toHaveBeenCalledTimes(1);
    expect(listSetWorkingCards).toHaveBeenCalledWith("ok");
  });
});
