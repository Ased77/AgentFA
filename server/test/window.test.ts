import { describe, expect, it } from "vitest";
import { retryAfter, windowStart } from "../src/lib/window.js";

describe("windowStart", () => {
  it("floors the timestamp to the start of the window", () => {
    const now = Date.UTC(2026, 8, 23, 12, 34, 56, 789);
    expect(windowStart(now, 60)).toBe(Date.UTC(2026, 8, 23, 12, 34, 0, 0));
    expect(windowStart(now, 3600)).toBe(Date.UTC(2026, 8, 23, 12, 0, 0, 0));
    expect(windowStart(now, 86400)).toBe(Date.UTC(2026, 8, 23, 0, 0, 0, 0));
  });

  it("is stable for every instant inside one window", () => {
    const start = Date.UTC(2026, 8, 23, 12, 0, 0, 0);
    for (const offset of [0, 1, 30_000, 59_999]) {
      expect(windowStart(start + offset, 60)).toBe(start);
    }
  });
});

describe("retryAfter", () => {
  it("counts down to the end of the current window", () => {
    const start = Date.UTC(2026, 8, 23, 12, 0, 0, 0);
    expect(retryAfter(start, 60)).toBe(60);
    expect(retryAfter(start + 30_000, 60)).toBe(30);
  });

  it("never returns less than one second", () => {
    const start = Date.UTC(2026, 8, 23, 12, 0, 0, 0);
    expect(retryAfter(start + 59_999, 60)).toBe(1);
  });
});
