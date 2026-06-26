import { describe, it, expect } from "vitest";
import seed from "../../public/data/nationals-history.json";
import { buildTriviaQuestions } from "./trivia";

const data = seed as any;
it("generates a healthy pool of well-formed questions", () => {
  const qs = buildTriviaQuestions(data);
  expect(qs.length).toBeGreaterThanOrEqual(10);
  for (const q of qs) {
    expect(typeof q.q).toBe("string");
    expect(q.q.length).toBeGreaterThan(0);
    expect(q.options).toContain(q.correct);
    expect(new Set(q.options).size).toBe(q.options.length); // no dup options
    expect(q.options.length).toBeGreaterThanOrEqual(2);
  }
});
