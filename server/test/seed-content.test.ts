import { describe, expect, it } from "vitest";
import { parseSeed } from "../src/seed-parse.js";

const validAgent = {
  id: "engineering-backend-architect",
  slug: "engineering-backend-architect",
  icon: "🏗️",
  name: "Backend Architect",
  category: "مهندسی",
  division: "engineering",
  divisionLabel: "Engineering",
  price: 49000,
  description: "Designs services that survive traffic.",
  longDescription: "Boring where it matters.",
  features: ["Schema design"],
  prompts: ["طراحی یک سرویس"],
  welcome: "سلام!",
};

const payload = {
  generatedAt: "2026-09-23T00:00:00.000Z",
  divisions: [
    {
      slug: "engineering",
      label: "Engineering",
      labelFa: "مهندسی",
      icon: "Code",
      color: "#3B82F6",
      sortOrder: 2,
    },
  ],
  agents: [validAgent],
  personas: { [validAgent.id]: "# Backend Architect\n\nFull body." },
};

describe("parseSeed", () => {
  it("accepts a well-formed seed", () => {
    const seed = parseSeed(JSON.stringify(payload));
    expect(seed.agents).toHaveLength(1);
    expect(seed.divisions[0]?.slug).toBe("engineering");
    expect(seed.personas[validAgent.id]).toContain("Full body");
  });

  it("defaults a missing persona map instead of throwing", () => {
    const { personas, ...withoutPersonas } = payload;
    expect(parseSeed(JSON.stringify(withoutPersonas)).personas).toEqual({});
  });

  it("rejects a seed without agents or divisions", () => {
    expect(() => parseSeed(JSON.stringify({ agents: [] }))).toThrow(/divisions/);
  });

  it("rejects an agent without an id", () => {
    const broken = { ...payload, agents: [{ ...validAgent, id: "" }] };
    expect(() => parseSeed(JSON.stringify(broken))).toThrow(/id and a slug/);
  });

  it("rejects an agent pointing at an unknown division", () => {
    const broken = { ...payload, agents: [{ ...validAgent, division: "nope" }] };
    expect(() => parseSeed(JSON.stringify(broken))).toThrow(/unknown division/);
  });
});
