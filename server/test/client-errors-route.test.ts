import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The ingest route's contract, tested without a database.
 *
 * `prisma` and the rate limiter are the only things here that need infrastructure,
 * so they are stubbed: what is under test is the route's own behaviour — what it
 * accepts, what it rejects, how a batch is counted, and whether two sightings of
 * one bug really collapse into a single row with a count.
 */

type UpsertArgs = {
  where: { fingerprint: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

const upserts: UpsertArgs[] = [];
const clientError = {
  upsert: vi.fn(async (args: UpsertArgs) => {
    upserts.push(args);
    return args.create;
  }),
  findMany: vi.fn(async () => []),
  count: vi.fn(async () => 0),
};

vi.mock("../src/db.js", () => ({
  prisma: { clientError, $queryRaw: vi.fn(async () => []), $transaction: vi.fn() },
}));

// The limiter counts against Postgres or Redis; neither exists here, and the
// limit itself is asserted separately.
const enforced: string[] = [];
vi.mock("../src/lib/limiter.js", () => ({
  enforceLimit: vi.fn(async (key: string) => {
    enforced.push(key);
  }),
}));

const { buildApp } = await import("../src/app.js");

const report = (over: Record<string, unknown> = {}) => ({
  kind: "error",
  message: "Cannot read properties of undefined (reading 'name')",
  stack: "Error: x\n    at Agent (/assets/index-abc123.js:10:5)",
  route: "/marketplace",
  release: "abc123",
  lang: "fa",
  viewport: "390x844",
  ...over,
});

describe("POST /api/client-errors", () => {
  beforeEach(() => {
    upserts.length = 0;
    enforced.length = 0;
    vi.clearAllMocks();
  });

  it("accepts a report and answers 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/client-errors",
      payload: { reports: [report()] },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ stored: 1 });
    expect(upserts).toHaveLength(1);
    await app.close();
  });

  it("stores redacted text and keeps the original only when a rule fired", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/client-errors",
      payload: { reports: [report({ message: "login failed for 09121234567" })] },
    });
    const created = upserts[0].create;
    expect(created.message).not.toContain("09121234567");
    expect(created.rawMessage).toBe("login failed for 09121234567");

    upserts.length = 0;
    await app.inject({
      method: "POST",
      url: "/api/client-errors",
      payload: { reports: [report({ message: "a clean message" })] },
    });
    expect(upserts[0].create.rawMessage).toBeNull();
    await app.close();
  });

  it("groups two sightings of one bug into a single fingerprint", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/client-errors",
      payload: {
        reports: [
          report({ message: "Failed to fetch agent 4211" }),
          report({ message: "Failed to fetch agent 9987" }),
        ],
      },
    });
    expect(upserts).toHaveLength(2);
    expect(upserts[0].where.fingerprint).toBe(upserts[1].where.fingerprint);
    // The second one increments rather than creating a duplicate row.
    expect(upserts[1].update).toHaveProperty("count");
    await app.close();
  });

  it("rejects an empty batch and an oversized one", async () => {
    const app = await buildApp();
    const empty = await app.inject({
      method: "POST",
      url: "/api/client-errors",
      payload: { reports: [] },
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error).toBe("reports_required");

    const many = await app.inject({
      method: "POST",
      url: "/api/client-errors",
      payload: { reports: Array.from({ length: 21 }, () => report()) },
    });
    expect(many.statusCode).toBe(400);
    expect(many.json().error).toBe("too_many_reports");
    await app.close();
  });

  it("charges one rate-limit slot per request, not per report", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/client-errors",
      payload: { reports: [report(), report({ message: "other" }), report({ message: "third" })] },
    });
    expect(enforced).toHaveLength(1);
    await app.close();
  });

  it("answers 400, not 500, for a body that is not JSON", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/client-errors",
      headers: { "content-type": "application/json" },
      payload: "not json at all",
    });
    // A 5xx here would be reported back as a crash by the client reporter,
    // inventing a failure out of a malformed request.
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_json");
    await app.close();
  });

  it("caps a hostile field instead of storing it whole", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/client-errors",
      payload: { reports: [report({ message: "x".repeat(2_000) })] },
    });
    expect(String(upserts[0].create.message).length).toBeLessThanOrEqual(500);
    await app.close();
  });

  it("keeps a path segment that looks like a slug, and drops one that does not", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/client-errors",
      payload: {
        reports: [
          report({ route: "/agent/level-designer" }),
          report({
            route: "/reset-password/9fK2mQ7pLxV4bN8sT1yZ6wR3dC5gH0jA2eF9uI4oP7k",
            message: "second",
          }),
        ],
      },
    });
    expect(upserts[0].create.route).toBe("/agent/level-designer");
    expect(String(upserts[1].create.route)).not.toContain("9fK2mQ7pLxV4bN8sT1yZ6wR3dC5gH0jA2eF9uI4oP7k");
    await app.close();
  });
});

describe("GET /api/admin/client-errors", () => {
  it("requires an admin session", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/admin/client-errors" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
