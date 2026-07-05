import { describe, it, expect } from "vitest";
import { stdbHttpBase } from "../stdbHttp";

describe("stdbHttpBase", () => {
  it("maps ws->http, wss->https, strips trailing slash", () => {
    expect(stdbHttpBase("ws://localhost:3000")).toBe("http://localhost:3000");
    expect(stdbHttpBase("wss://maincloud.spacetimedb.com/")).toBe("https://maincloud.spacetimedb.com");
    expect(stdbHttpBase("https://already.example")).toBe("https://already.example");
  });
});
