import { describe, expect, it } from "vitest";
import {
  CODE_LENGTH,
  codeMatches,
  generateCode,
  hashCode,
  isUsable,
  requirePhone,
  verificationError,
} from "../src/auth/otp.js";
import { HttpError } from "../src/lib/errors.js";
import { receptorOf, returnReason } from "../src/sms/kavenegar.js";

const SECRET = "a".repeat(64);
const PHONE = "+989121234567";

describe("generateCode", () => {
  it("always produces six digits, zero-padded", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it("does not repeat itself in a small sample", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateCode()));
    expect(codes.size).toBeGreaterThan(45);
  });
});

describe("code hashing", () => {
  it("accepts the right code and only that code", () => {
    const hash = hashCode(PHONE, "123456", SECRET);
    expect(codeMatches(hash, PHONE, "123456", SECRET)).toBe(true);
    expect(codeMatches(hash, PHONE, "123457", SECRET)).toBe(false);
    expect(codeMatches(hash, PHONE, "12345", SECRET)).toBe(false);
    expect(codeMatches(hash, PHONE, "1234567", SECRET)).toBe(false);
  });

  it("binds the code to the phone number", () => {
    // A row stolen for one number cannot be replayed against another.
    const hash = hashCode(PHONE, "123456", SECRET);
    expect(codeMatches(hash, "+989120000000", "123456", SECRET)).toBe(false);
  });

  it("needs the server secret to verify", () => {
    const hash = hashCode(PHONE, "123456", SECRET);
    expect(codeMatches(hash, PHONE, "123456", "b".repeat(64))).toBe(false);
  });

  it("is never the plain code", () => {
    expect(hashCode(PHONE, "123456", SECRET)).not.toContain("123456");
    expect(hashCode(PHONE, "123456", SECRET)).toHaveLength(64);
  });

  it("rejects a malformed stored hash instead of throwing", () => {
    expect(codeMatches("not-a-hash", PHONE, "123456", SECRET)).toBe(false);
    expect(codeMatches("", PHONE, "123456", SECRET)).toBe(false);
  });
});

describe("isUsable", () => {
  const now = Date.now();
  const base = { expiresAt: new Date(now + 60_000), consumedAt: null, attempts: 0 };

  it("accepts a fresh unconsumed code", () => {
    expect(isUsable(base, now, 5)).toBe(true);
  });

  it("refuses expired, consumed and exhausted challenges", () => {
    expect(isUsable({ ...base, expiresAt: new Date(now - 1) }, now, 5)).toBe(false);
    expect(isUsable({ ...base, consumedAt: new Date(now - 1000) }, now, 5)).toBe(false);
    expect(isUsable({ ...base, attempts: 5 }, now, 5)).toBe(false);
  });
});

describe("requirePhone", () => {
  it("normalizes what the form sent", () => {
    expect(requirePhone("۰۹۱۲ ۱۲۳ ۴۵۶۷")).toBe(PHONE);
  });

  it("distinguishes a missing number from an invalid one", () => {
    expect(() => requirePhone("")).toThrowError(
      expect.objectContaining({ code: "phone_required", status: 400 }),
    );
    expect(() => requirePhone("02188776655")).toThrowError(
      expect.objectContaining({ code: "invalid_phone", status: 400 }),
    );
  });
});

describe("verificationError", () => {
  it("maps failures onto the right status", () => {
    expect(verificationError("invalid_code")).toBeInstanceOf(HttpError);
    expect((verificationError("invalid_code") as HttpError).status).toBe(401);
    expect((verificationError("code_expired") as HttpError).status).toBe(401);
    expect((verificationError("too_many_attempts") as HttpError).status).toBe(429);
  });
});

describe("kavenegar adapter helpers", () => {
  it("sends the receptor without a plus sign", () => {
    expect(receptorOf("+989121234567")).toBe("989121234567");
  });

  it("translates return codes into reasons worth logging", () => {
    expect(returnReason(424, "credit")).toBe("insufficient_credit:credit");
    expect(returnReason(418, "")).toBe("template_not_found");
    expect(returnReason(999, "odd")).toBe("gateway_999:odd");
    expect(returnReason(undefined, undefined)).toBe("gateway_unreachable");
  });
});
