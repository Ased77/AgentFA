import { describe, expect, it } from "vitest";
import { AGENT_SELECT, divisionCounts, toCatalogDivision } from "../src/provider/catalog-map.js";

describe("divisionCounts", () => {
  it("maps each division to its agent count", () => {
    const counts = divisionCounts([
      { division: "engineering", _count: { _all: 31 } },
      { division: "design", _count: { _all: 6 } },
    ]);
    expect(counts.get("engineering")).toBe(31);
    expect(counts.get("design")).toBe(6);
    expect(counts.get("academic")).toBeUndefined();
  });
});

describe("toCatalogDivision", () => {
  it("exposes the public shape and drops internal ordering", () => {
    const division = toCatalogDivision(
      {
        slug: "engineering",
        label: "Engineering",
        labelFa: "مهندسی",
        icon: "Code",
        color: "#3B82F6",
        sortOrder: 2,
      },
      31,
    );
    expect(division).toEqual({
      slug: "engineering",
      label: "Engineering",
      labelFa: "مهندسی",
      icon: "Code",
      color: "#3B82F6",
      count: 31,
    });
    expect("sortOrder" in division).toBe(false);
  });
});

describe("AGENT_SELECT", () => {
  it("keeps internal bookkeeping out of the public catalog", () => {
    for (const field of ["createdAt", "updatedAt"]) {
      expect(AGENT_SELECT).not.toHaveProperty(field);
    }
    expect(AGENT_SELECT.price).toBe(true);
  });
});
