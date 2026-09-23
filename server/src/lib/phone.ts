/**
 * Iranian mobile numbers.
 *
 * Users type their number in every conceivable shape — `0912…`, `+98 912…`,
 * `00989…`, with Persian or Arabic-Indic digits, with spaces, dashes or dots —
 * and the database must see exactly one canonical form or the same person ends
 * up with two accounts. Everything is normalized to E.164 (`+989121234567`).
 */

/** `۰۱۲۳۴۵۶۷۸۹` — the digits a Persian keyboard produces. */
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
/** `٠١٢٣٤٥٦٧٨٩` — Arabic-Indic, still common on imported keyboards. */
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Convert Persian/Arabic-Indic digits to ASCII and drop formatting. */
export function toAsciiDigits(input: string): string {
  let out = "";
  for (const char of input) {
    const persian = PERSIAN_DIGITS.indexOf(char);
    if (persian >= 0) {
      out += String(persian);
      continue;
    }
    const arabic = ARABIC_DIGITS.indexOf(char);
    if (arabic >= 0) {
      out += String(arabic);
      continue;
    }
    out += char;
  }
  return out;
}

export type PhoneResult =
  | { ok: true; phone: string }
  | { ok: false; reason: "empty" | "invalid" };

/**
 * Normalize to `+989xxxxxxxxx`.
 *
 * Iranian mobile numbers are the national prefix `9` plus nine digits; the
 * leading `0` is dropped once a country code is present. Landlines (which start
 * with an area code like `021`) are rejected by the same rule, as are numbers
 * that are simply too short or too long.
 */
export function normalizePhone(input: string): PhoneResult {
  const digits = toAsciiDigits(String(input ?? "")).replace(/\D/g, "");
  if (!digits) return { ok: false, reason: "empty" };

  let national = digits;
  if (national.startsWith("0098")) national = national.slice(4);
  else if (national.startsWith("98") && national.length === 12) national = national.slice(2);
  else if (national.startsWith("0") && national.length === 11) national = national.slice(1);

  // Exactly ten digits, starting with 9 (the mobile prefix).
  if (!/^9\d{9}$/.test(national)) return { ok: false, reason: "invalid" };
  return { ok: true, phone: `+98${national}` };
}

/** `+989121234567` → `0912 345 6789`, the shape users recognize. */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const national = digits.startsWith("98") ? digits.slice(2) : digits;
  if (!/^9\d{9}$/.test(national)) return phone;
  return `0${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
}

/** Never log a full number: `+98912***4567` is enough to trace a complaint. */
export function maskPhone(phone: string): string {
  if (phone.length < 8) return "***";
  return `${phone.slice(0, 6)}***${phone.slice(-4)}`;
}
