/**
 * Client-side mirror of the server's phone rules.
 *
 * The server normalizes and validates again — it is the source of truth — so this
 * exists only to give instant feedback and to render a number the way people
 * recognize it. Keep the accepted shapes in step with `server/src/lib/phone.ts`.
 */

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Convert Persian/Arabic-Indic digits to ASCII. */
export function toAsciiDigits(input: string): string {
  let out = "";
  for (const char of input) {
    const persian = PERSIAN_DIGITS.indexOf(char);
    if (persian >= 0) {
      out += String(persian);
      continue;
    }
    const arabic = ARABIC_DIGITS.indexOf(char);
    out += arabic >= 0 ? String(arabic) : char;
  }
  return out;
}

/** `۰۹۱۲ ۱۲۳ ۴۵۶۷` and `+98 912 123 4567` both become `+989121234567`. */
export function normalizePhone(input: string): { ok: true; phone: string } | { ok: false } {
  const digits = toAsciiDigits(String(input ?? "")).replace(/\D/g, "");
  if (!digits) return { ok: false };

  let national = digits;
  if (national.startsWith("0098")) national = national.slice(4);
  else if (national.startsWith("98") && national.length === 12) national = national.slice(2);
  else if (national.startsWith("0") && national.length === 11) national = national.slice(1);

  if (!/^9\d{9}$/.test(national)) return { ok: false };
  return { ok: true, phone: `+98${national}` };
}

/** `+989121234567` → `0912 123 4567`. */
export function formatPhone(phone: string): string {
  const national = phone.replace(/\D/g, "").replace(/^98/, "");
  if (!/^9\d{9}$/.test(national)) return phone;
  return `0${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
}

/** Persian readers expect Persian digits, even for numbers we format ourselves. */
export function localizeDigits(text: string, lang: "fa" | "en"): string {
  if (lang !== "fa") return text;
  return text.replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)]!);
}
