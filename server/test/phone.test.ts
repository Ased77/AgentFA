import { describe, expect, it } from "vitest";
import { formatPhone, maskPhone, normalizePhone, toAsciiDigits } from "../src/lib/phone.js";

describe("normalizePhone", () => {
  it("accepts every shape users type for the same number", () => {
    const expected = "+989121234567";
    const shapes = [
      "09121234567",
      "9121234567",
      "+989121234567",
      "00989121234567",
      "989121234567",
      "0912 123 4567",
      "0912-123-4567",
      "  0912.123.4567  ",
      "(0912) 123 4567",
      "+98 (912) 123-4567",
    ];
    for (const shape of shapes) {
      expect(normalizePhone(shape), shape).toEqual({ ok: true, phone: expected });
    }
  });

  it("reads Persian and Arabic-Indic digits", () => {
    expect(normalizePhone("۰۹۱۲۱۲۳۴۵۶۷")).toEqual({ ok: true, phone: "+989121234567" });
    expect(normalizePhone("٠٩١٢١٢٣٤٥٦٧")).toEqual({ ok: true, phone: "+989121234567" });
    // Mixed scripts and a zero-width non-joiner, as pasted from a chat app.
    expect(normalizePhone("۰۹۱۲\u200c1234567")).toEqual({ ok: true, phone: "+989121234567" });
  });

  it("rejects landlines, short numbers and non-numbers", () => {
    expect(normalizePhone("02188776655")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizePhone("0912123456")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizePhone("091212345678")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizePhone("+1 415 555 0100")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizePhone("call me maybe")).toEqual({ ok: false, reason: "empty" });
    expect(normalizePhone("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("does not treat a country code inside a longer number as the prefix", () => {
    // 12 digits starting with 98 but not a valid national number.
    expect(normalizePhone("9812345678901")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("toAsciiDigits", () => {
  it("converts both digit scripts and leaves the rest alone", () => {
    expect(toAsciiDigits("۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789");
    expect(toAsciiDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(toAsciiDigits("tel: ۰۹۱۲")).toBe("tel: 0912");
  });
});

describe("formatPhone", () => {
  it("renders the local shape users recognize", () => {
    expect(formatPhone("+989121234567")).toBe("0912 123 4567");
  });

  it("returns the input unchanged when it is not a mobile number", () => {
    expect(formatPhone("+14155550100")).toBe("+14155550100");
  });
});

describe("maskPhone", () => {
  it("keeps a prefix and suffix for support, never the whole number", () => {
    expect(maskPhone("+989121234567")).toBe("+98912***4567");
    expect(maskPhone("+98")).toBe("***");
  });
});
