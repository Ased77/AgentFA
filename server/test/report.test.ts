import { describe, expect, it } from "vitest";
import {
  fingerprint,
  normalizeAsset,
  normalizeForFingerprint,
  normalizeReport,
  normalizeRoute,
  redact,
  topFrame,
  truncate,
} from "../src/lib/report.js";

describe("redact", () => {
  it("removes a token, a code and a password wherever they appear", () => {
    expect(redact("GET /api/chat?token=abc123secret").message).toBe(
      "GET /api/chat?token=[redacted]",
    );
    expect(redact("otp: 123456").message).toBe("otp=[redacted]");
    expect(redact("password=hunter2").message).toBe("password=[redacted]");
    expect(redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def").message).not.toContain(
      "eyJhbGciOiJIUzI1NiJ9",
    );
    const jwt = redact("token=eyJhbGciOiJIUzI1NiJ9.abc.def").message;
    expect(jwt).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(jwt).toContain("[redacted]");
  });

  it("removes phone numbers in every shape the product accepts", () => {
    for (const phone of ["09121234567", "+989121234567", "989121234567"]) {
      expect(redact(`login failed for ${phone}`).message).toContain("[phone]");
      expect(redact(`login failed for ${phone}`).message).not.toContain(phone.slice(-9));
    }
  });

  it("removes emails and long opaque blobs", () => {
    expect(redact("mail to ased@example.com failed").message).toBe("mail to [email] failed");
    expect(redact("id d41d8cd98f00b204e9800998ecf8427e").message).toContain("[hash]");
  });

  it("keeps the original only when a rule actually fired", () => {
    expect(redact("plain message about a crash").rawMessage).toBeNull();
    const changed = redact("phone 09121234567 rejected");
    expect(changed.rawMessage).toBe("phone 09121234567 rejected");
    expect(changed.message).not.toBe(changed.rawMessage);
  });

  it("redacts a cookie value without removing the cookie name", () => {
    const { message } = redact("Cookie: agentfa_session=abc123def456; theme=dark");
    expect(message).toContain("agentfa_session=[redacted]");
    expect(message).not.toContain("abc123def456");
  });
});

describe("normalizeForFingerprint", () => {
  it("collapses ids, numbers and quoted values so instances group", () => {
    const a = normalizeForFingerprint("Failed to load agent 4211 in \"Level Designer\"");
    const b = normalizeForFingerprint("Failed to load agent 9987 in \"Writer\"");
    expect(a).toBe(b);
  });

  it("keeps different messages apart", () => {
    expect(normalizeForFingerprint("cannot read properties of undefined")).not.toBe(
      normalizeForFingerprint("network request failed"),
    );
  });
});

describe("normalizeAsset", () => {
  it("drops the origin and the build hash, so a deploy does not create a new group", () => {
    expect(normalizeAsset("https://agent-fa-three.vercel.app/assets/index-f6HKisvP.js")).toBe(
      "/assets/index.js",
    );
    expect(normalizeAsset("/assets/index-B_K787ei.js")).toBe("/assets/index.js");
    expect(normalizeAsset("/assets/chat-abc123.css?v=2")).toBe("/assets/chat.css");
    // A source path with no hash is left alone.
    expect(normalizeAsset("/src/routes.tsx")).toBe("/src/routes.tsx");
  });
});

describe("topFrame", () => {
  const stack = [
    "Error: boom",
    "    at renderAgent (https://site/assets/index-f6HKisvP.js:12:34)",
    "    at renderWithHooks (https://site/node_modules/react-dom/client.js:1:1)",
    "    at Object.workLoop (https://site/node_modules/scheduler/index.js:2:3)",
  ].join("\n");

  it("skips the framework's own frames and keeps line and column", () => {
    expect(topFrame(stack)).toBe("renderAgent@/assets/index.js:12:34");
  });

  it("is empty when every frame is framework machinery", () => {
    const only = ["Error: boom", "    at x (node_modules/react-dom/client.js:1:1)"].join("\n");
    expect(topFrame(only)).toBe("");
  });
});

describe("fingerprint", () => {
  it("is stable across ids and across builds", () => {
    const first = fingerprint({
      kind: "error",
      message: "Cannot read properties of undefined (reading 'name')",
      stack: "Error: x\n    at Agent (https://s/assets/index-aaa111.js:10:5)",
      source: "",
    });
    const second = fingerprint({
      kind: "error",
      message: "Cannot read properties of undefined (reading 'name')",
      stack: "Error: x\n    at Agent (https://s/assets/index-bbb222.js:10:5)",
      source: "",
    });
    expect(first).toBe(second);
  });

  it("separates different failures", () => {
    const base = { kind: "error", message: "boom", stack: "", source: "" };
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, kind: "fetch" }));
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, message: "bang" }));
  });
});

describe("normalizeRoute", () => {
  it("keeps the path and discards the query string", () => {
    expect(normalizeRoute("/chat?agentId=level-designer&token=secret")).toBe("/chat");
    expect(normalizeRoute("https://site/agent/writer?a=1")).toBe("/agent/writer");
    expect(normalizeRoute("pricing")).toBe("/pricing");
  });

  it("handles nonsense without throwing", () => {
    expect(normalizeRoute("")).toBe("");
    expect(normalizeRoute(undefined)).toBe("");
    // An unparseable URL loses its scheme instead of becoming `/http://…`.
    expect(normalizeRoute("http://[")).toBe("/[");
  });

  it("redacts a secret that travelled in the path, not the query", () => {
    const token = "9fK2mQ7pLxV4bN8sT1yZ6wR3dC5gH0jA2eF9uI4oP7k";
    const report = normalizeReport({ kind: "error", message: "x", route: `/reset-password/${token}` });
    expect(report.route).not.toContain(token);
    expect(report.route).toBe("/reset-password/[redacted]");
  });

  it("keeps real page slugs, so routes still group by page", () => {
    expect(normalizeReport({ message: "x", route: "/agent/level-designer" }).route).toBe(
      "/agent/level-designer",
    );
    expect(normalizeReport({ message: "x", route: "/agent/data-science-engineer" }).route).toBe(
      "/agent/data-science-engineer",
    );
  });
});

describe("normalizeReport", () => {
  it("redacts, caps and fingerprints in one pass", () => {
    const report = normalizeReport({
      kind: "react",
      message: `crashed for 09121234567 ${"x".repeat(900)}`,
      stack: "Error: x\n    at Agent (/assets/index-abc123.js:1:1)",
      route: "/dashboard?token=secret",
      release: "b83ccd7",
      lang: "fa",
      viewport: "390x844",
    });
    expect(report.kind).toBe("react");
    expect(report.message).not.toContain("09121234567");
    expect(report.message.length).toBeLessThanOrEqual(500);
    expect(report.route).toBe("/dashboard");
    expect(report.fingerprint).toHaveLength(32);
    expect(report.release).toBe("b83ccd7");
  });

  it("treats an unknown kind as unknown instead of rejecting the report", () => {
    expect(normalizeReport({ kind: "something-new", message: "x" }).kind).toBe("unknown");
    expect(normalizeReport({ message: "x" }).kind).toBe("unknown");
  });

  it("never throws on hostile input", () => {
    expect(() => normalizeReport({ kind: 42, message: null, stack: {}, route: [] })).not.toThrow();
    const report = normalizeReport({});
    expect(report.message).toBe("(no message)");
    expect(report.fingerprint).toHaveLength(32);
  });

  it("groups two sightings of one bug, whatever the id", () => {
    const one = normalizeReport({
      kind: "error",
      message: "Failed to fetch agent 4211",
      stack: "Error: x\n    at load (/assets/agents-aaa111.js:3:9)",
    });
    const two = normalizeReport({
      kind: "error",
      message: "Failed to fetch agent 9987",
      stack: "Error: x\n    at load (/assets/agents-bbb222.js:3:9)",
    });
    expect(one.fingerprint).toBe(two.fingerprint);
  });
});

describe("truncate", () => {
  it("marks that it cut the value", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abc", 4)).toBe("abc");
  });
});
