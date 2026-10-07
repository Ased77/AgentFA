/**
 * Phone numbers, client side.
 *
 * Two rules live here, and they are not the same rule:
 *
 *  1. `normalizePhone` mirrors `server/src/lib/phone.ts` — the home market. The
 *     deployment sends SMS through an Iranian gateway, so the API still accepts
 *     Iranian mobiles only and canonicalises them to `+989xxxxxxxxx`. Keep the
 *     accepted shapes in step with the server; it is the source of truth.
 *  2. `COUNTRIES` + `normalizeCountryPhone` back the login page's country picker.
 *     They turn a country plus the national number someone types into E.164.
 *     Dial codes, national lengths, trunk prefixes and the examples come from
 *     libphonenumber's metadata (the ITU/E.164 numbering plans), so the table is
 *     data rather than folklore — 83 countries, with Iran's strict mobile rule and
 *     NANP's on top. A wrong length here rejects a real number, so anything
 *     uncertain is left out rather than guessed at.
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

/**
 * One row per country the picker offers.
 *
 * `lengths` are the national-number lengths a mobile can have *after* the trunk
 * prefix is dropped, `trunk` is what people type in front of it at home (`0` in
 * Iran, `06` in Hungary, `8` in Russia — it is not stored in E.164), and `example`
 * is a real mobile number in the shape people write it, used as the placeholder.
 * `pattern` tightens countries whose mobile range is narrow enough to say so.
 */
export type Country = {
  /** ISO 3166-1 alpha-2. */
  iso: string;
  /** Country calling code, digits only, without the `+`. */
  dial: string;
  fa: string;
  en: string;
  trunk: string;
  lengths: number[];
  example: string;
  pattern?: RegExp;
};

/**
 * Iran is the home market: it is first in the table, the FA default, and its rule
 * is the one the API uses, so it lives outside `COUNTRIES` to be reusable as the
 * `IRAN` constant.
 */
export const IRAN: Country = {
  iso: "IR",
  dial: "98",
  fa: "ایران",
  en: "Iran",
  trunk: "0",
  lengths: [10],
  example: "0912 345 6789",
  // Mobiles only: an Iranian landline can never receive the login SMS, so it is
  // rejected here exactly as the server rejects it.
  pattern: /^9\d{9}$/,
};

/**
 * The countries the picker offers, Iran first.
 *
 * The United States precedes Canada on purpose: they share `+1`, and when a whole
 * international number is pasted the first match wins. Both numbers are dialled
 * the same way, so the only thing the order decides is which name is shown.
 */
export const COUNTRIES: Country[] = [
  IRAN,
  { iso: "AF", dial: "93", fa: "افغانستان", en: "Afghanistan", trunk: "0", lengths: [9], example: "070 123 4567" },
  { iso: "IQ", dial: "964", fa: "عراق", en: "Iraq", trunk: "0", lengths: [10], example: "0791 234 5678" },
  { iso: "TR", dial: "90", fa: "ترکیه", en: "Türkiye", trunk: "0", lengths: [10], example: "0501 234 56 78" },
  { iso: "AZ", dial: "994", fa: "آذربایجان", en: "Azerbaijan", trunk: "0", lengths: [9], example: "040 123 45 67" },
  { iso: "AM", dial: "374", fa: "ارمنستان", en: "Armenia", trunk: "0", lengths: [8], example: "077 123456" },
  { iso: "GE", dial: "995", fa: "گرجستان", en: "Georgia", trunk: "0", lengths: [9], example: "555 12 34 56" },
  { iso: "TM", dial: "993", fa: "ترکمنستان", en: "Turkmenistan", trunk: "8", lengths: [8], example: "8 66 123456" },
  { iso: "UZ", dial: "998", fa: "ازبکستان", en: "Uzbekistan", trunk: "", lengths: [9], example: "91 234 56 78" },
  { iso: "TJ", dial: "992", fa: "تاجیکستان", en: "Tajikistan", trunk: "", lengths: [9], example: "91 712 3456" },
  { iso: "KG", dial: "996", fa: "قرقیزستان", en: "Kyrgyzstan", trunk: "0", lengths: [9], example: "0700 123 456" },
  { iso: "PK", dial: "92", fa: "پاکستان", en: "Pakistan", trunk: "0", lengths: [10], example: "0301 2345678" },
  { iso: "IN", dial: "91", fa: "هند", en: "India", trunk: "0", lengths: [10], example: "081234 56789" },
  { iso: "BD", dial: "880", fa: "بنگلادش", en: "Bangladesh", trunk: "0", lengths: [10], example: "01812-345678" },
  { iso: "LK", dial: "94", fa: "سری‌لانکا", en: "Sri Lanka", trunk: "0", lengths: [9], example: "071 234 5678" },
  { iso: "AE", dial: "971", fa: "امارات متحده عربی", en: "United Arab Emirates", trunk: "0", lengths: [9], example: "050 123 4567" },
  { iso: "QA", dial: "974", fa: "قطر", en: "Qatar", trunk: "", lengths: [8], example: "3312 3456" },
  { iso: "KW", dial: "965", fa: "کویت", en: "Kuwait", trunk: "", lengths: [8], example: "500 12345" },
  { iso: "OM", dial: "968", fa: "عمان", en: "Oman", trunk: "", lengths: [8], example: "9212 3456" },
  { iso: "BH", dial: "973", fa: "بحرین", en: "Bahrain", trunk: "", lengths: [8], example: "3600 1234" },
  { iso: "SA", dial: "966", fa: "عربستان سعودی", en: "Saudi Arabia", trunk: "0", lengths: [9], example: "051 234 5678" },
  { iso: "LB", dial: "961", fa: "لبنان", en: "Lebanon", trunk: "0", lengths: [7, 8], example: "71 123 456" },
  { iso: "JO", dial: "962", fa: "اردن", en: "Jordan", trunk: "0", lengths: [9], example: "07 9012 3456" },
  { iso: "SY", dial: "963", fa: "سوریه", en: "Syria", trunk: "0", lengths: [9], example: "0944 567 890" },
  { iso: "YE", dial: "967", fa: "یمن", en: "Yemen", trunk: "0", lengths: [9], example: "0712 345 678" },
  { iso: "EG", dial: "20", fa: "مصر", en: "Egypt", trunk: "0", lengths: [10], example: "010 01234567" },
  { iso: "MA", dial: "212", fa: "مراکش", en: "Morocco", trunk: "0", lengths: [9], example: "06 50 12 34 56" },
  { iso: "DZ", dial: "213", fa: "الجزایر", en: "Algeria", trunk: "0", lengths: [9], example: "0551 23 45 67" },
  { iso: "TN", dial: "216", fa: "تونس", en: "Tunisia", trunk: "", lengths: [8], example: "20 123 456" },
  { iso: "DE", dial: "49", fa: "آلمان", en: "Germany", trunk: "0", lengths: [10, 11], example: "01512 3456789" },
  { iso: "SE", dial: "46", fa: "سوئد", en: "Sweden", trunk: "0", lengths: [9], example: "070-123 45 67" },
  { iso: "NO", dial: "47", fa: "نروژ", en: "Norway", trunk: "", lengths: [8], example: "40 61 23 45" },
  { iso: "DK", dial: "45", fa: "دانمارک", en: "Denmark", trunk: "", lengths: [8], example: "34 41 23 45" },
  { iso: "FI", dial: "358", fa: "فنلاند", en: "Finland", trunk: "0", lengths: [6, 7, 8, 9, 10], example: "041 2345678" },
  { iso: "NL", dial: "31", fa: "هلند", en: "Netherlands", trunk: "0", lengths: [9, 11], example: "06 12345678" },
  { iso: "BE", dial: "32", fa: "بلژیک", en: "Belgium", trunk: "0", lengths: [9], example: "0450 00 12 34" },
  { iso: "AT", dial: "43", fa: "اتریش", en: "Austria", trunk: "0", lengths: [7, 8, 9, 10, 11, 12, 13], example: "0664 123456" },
  { iso: "CH", dial: "41", fa: "سوئیس", en: "Switzerland", trunk: "0", lengths: [9], example: "078 123 45 67" },
  { iso: "FR", dial: "33", fa: "فرانسه", en: "France", trunk: "0", lengths: [9], example: "06 12 34 56 78" },
  { iso: "IT", dial: "39", fa: "ایتالیا", en: "Italy", trunk: "", lengths: [9, 10], example: "312 345 6789" },
  { iso: "ES", dial: "34", fa: "اسپانیا", en: "Spain", trunk: "", lengths: [9], example: "612 34 56 78" },
  { iso: "PT", dial: "351", fa: "پرتغال", en: "Portugal", trunk: "", lengths: [9], example: "912 345 678" },
  { iso: "GR", dial: "30", fa: "یونان", en: "Greece", trunk: "", lengths: [10], example: "691 234 5678" },
  { iso: "CY", dial: "357", fa: "قبرس", en: "Cyprus", trunk: "", lengths: [8], example: "96 123456" },
  { iso: "GB", dial: "44", fa: "بریتانیا", en: "United Kingdom", trunk: "0", lengths: [10], example: "07400 123456" },
  { iso: "IE", dial: "353", fa: "ایرلند", en: "Ireland", trunk: "0", lengths: [9], example: "085 012 3456" },
  { iso: "PL", dial: "48", fa: "لهستان", en: "Poland", trunk: "", lengths: [9], example: "512 345 678" },
  { iso: "CZ", dial: "420", fa: "جمهوری چک", en: "Czechia", trunk: "", lengths: [9], example: "601 123 456" },
  { iso: "SK", dial: "421", fa: "اسلواکی", en: "Slovakia", trunk: "0", lengths: [9], example: "0912 123 456" },
  { iso: "RO", dial: "40", fa: "رومانی", en: "Romania", trunk: "0", lengths: [9], example: "0712 034 567" },
  { iso: "HU", dial: "36", fa: "مجارستان", en: "Hungary", trunk: "06", lengths: [9], example: "06 20 123 4567" },
  { iso: "BG", dial: "359", fa: "بلغارستان", en: "Bulgaria", trunk: "0", lengths: [8, 9], example: "043 012 345" },
  { iso: "RS", dial: "381", fa: "صربستان", en: "Serbia", trunk: "0", lengths: [8, 9, 10], example: "060 1234567" },
  { iso: "HR", dial: "385", fa: "کرواسی", en: "Croatia", trunk: "0", lengths: [8, 9], example: "092 123 4567" },
  { iso: "RU", dial: "7", fa: "روسیه", en: "Russia", trunk: "8", lengths: [10], example: "8 (912) 345-67-89" },
  { iso: "UA", dial: "380", fa: "اوکراین", en: "Ukraine", trunk: "0", lengths: [9], example: "050 123 4567" },
  { iso: "MD", dial: "373", fa: "مولداوی", en: "Moldova", trunk: "0", lengths: [8], example: "0621 12 345" },
  { iso: "IS", dial: "354", fa: "ایسلند", en: "Iceland", trunk: "", lengths: [7, 9], example: "611 1234" },
  { iso: "LU", dial: "352", fa: "لوکزامبورگ", en: "Luxembourg", trunk: "", lengths: [9], example: "628 123 456" },
  { iso: "MT", dial: "356", fa: "مالت", en: "Malta", trunk: "", lengths: [8], example: "9696 1234" },
  { iso: "US", dial: "1", fa: "ایالات متحده آمریکا", en: "United States", trunk: "1", lengths: [10], example: "(201) 555-0123", pattern: /^[2-9]\d{2}[2-9]\d{6}$/ },
  { iso: "CA", dial: "1", fa: "کانادا", en: "Canada", trunk: "1", lengths: [10], example: "(506) 234-5678", pattern: /^[2-9]\d{2}[2-9]\d{6}$/ },
  { iso: "MX", dial: "52", fa: "مکزیک", en: "Mexico", trunk: "", lengths: [10], example: "222 123 4567" },
  { iso: "BR", dial: "55", fa: "برزیل", en: "Brazil", trunk: "0", lengths: [10, 11], example: "(11) 96123-4567" },
  { iso: "CL", dial: "56", fa: "شیلی", en: "Chile", trunk: "", lengths: [9], example: "(2) 2123 4567" },
  { iso: "CO", dial: "57", fa: "کلمبیا", en: "Colombia", trunk: "0", lengths: [10], example: "321 1234567" },
  { iso: "PE", dial: "51", fa: "پرو", en: "Peru", trunk: "0", lengths: [9], example: "912 345 678" },
  { iso: "AU", dial: "61", fa: "استرالیا", en: "Australia", trunk: "0", lengths: [9], example: "0412 345 678" },
  { iso: "NZ", dial: "64", fa: "نیوزیلند", en: "New Zealand", trunk: "0", lengths: [8, 9, 10], example: "021 123 4567" },
  { iso: "JP", dial: "81", fa: "ژاپن", en: "Japan", trunk: "0", lengths: [10], example: "090-1234-5678" },
  { iso: "CN", dial: "86", fa: "چین", en: "China", trunk: "0", lengths: [11], example: "131 2345 6789" },
  { iso: "KR", dial: "82", fa: "کره جنوبی", en: "South Korea", trunk: "0", lengths: [9, 10], example: "010-2000-0000" },
  { iso: "HK", dial: "852", fa: "هنگ‌کنگ", en: "Hong Kong", trunk: "", lengths: [8], example: "5123 4567" },
  { iso: "SG", dial: "65", fa: "سنگاپور", en: "Singapore", trunk: "", lengths: [8], example: "8123 4567" },
  { iso: "MY", dial: "60", fa: "مالزی", en: "Malaysia", trunk: "0", lengths: [9, 10], example: "012-345 6789" },
  { iso: "ID", dial: "62", fa: "اندونزی", en: "Indonesia", trunk: "0", lengths: [9, 10, 11, 12], example: "0812-345-678" },
  { iso: "TH", dial: "66", fa: "تایلند", en: "Thailand", trunk: "0", lengths: [9], example: "081 234 5678" },
  { iso: "PH", dial: "63", fa: "فیلیپین", en: "Philippines", trunk: "0", lengths: [10], example: "0905 123 4567" },
  { iso: "VN", dial: "84", fa: "ویتنام", en: "Vietnam", trunk: "0", lengths: [9], example: "0912 345 678" },
  { iso: "ZA", dial: "27", fa: "آفریقای جنوبی", en: "South Africa", trunk: "0", lengths: [5, 6, 7, 8, 9], example: "071 123 4567" },
  { iso: "NG", dial: "234", fa: "نیجریه", en: "Nigeria", trunk: "0", lengths: [10], example: "0802 123 4567" },
  { iso: "KE", dial: "254", fa: "کنیا", en: "Kenya", trunk: "0", lengths: [9], example: "0712 123456" },
  { iso: "GH", dial: "233", fa: "غنا", en: "Ghana", trunk: "0", lengths: [9], example: "023 123 4567" },
];

const BY_ISO_CODE = new Map(COUNTRIES.map((country) => [country.iso, country]));

/** The country a region code names, when the picker offers it. */
export function countryByIso(iso: string | undefined): Country | undefined {
  return iso ? BY_ISO_CODE.get(iso.toUpperCase()) : undefined;
}

/** Localized country name: `ایران` in FA, `Iran` in EN. */
export function countryName(country: Country, lang: "fa" | "en"): string {
  return lang === "fa" ? country.fa : country.en;
}

/**
 * Which country the picker starts on.
 *
 * Persian readers get Iran — the product is Persian-first and Iran is where it
 * sells. An English reader gets the country their own locale names when the
 * table has it (`en-GB` → `GB`) and Iran otherwise, which is the honest default
 * for an Iranian product: most English readers here are still in Iran or part of
 * the diaspora, and everyone else has the picker.
 */
export function defaultCountry(lang: "fa" | "en"): Country {
  if (lang === "fa") return IRAN;
  const region =
    typeof navigator === "undefined" ? undefined : navigator.language?.split("-")[1];
  return countryByIso(region) ?? IRAN;
}

/**
 * Read a whole international number someone pasted: `+44 7400 123456`, `0098 912…`.
 *
 * Only an explicit `+`/`00` triggers this — a national number that happens to
 * start with its own dial code is not an international number. When two countries
 * share a dial code (`+1`), the first one in `COUNTRIES` wins; the number that is
 * dialled is the same either way.
 */
export function matchInternational(
  input: string,
): { country: Country; national: string } | null {
  const text = toAsciiDigits(String(input ?? "")).trim();
  if (!text.startsWith("+") && !text.startsWith("00")) return null;
  const digits = text.replace(/\D/g, "").replace(/^00/, "");
  const candidates = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  for (const country of candidates) {
    if (!digits.startsWith(country.dial)) continue;
    const national = digits.slice(country.dial.length);
    if (normalizeCountryPhone(country, national).ok) return { country, national };
  }
  // Still being typed, not pasted: switch the country as soon as the dial code
  // is complete, so the rest lands in the right place instead of watching the
  // `+` disappear as an unparseable character.
  for (const country of candidates) {
    if (!digits.startsWith(country.dial)) continue;
    const national = digits.slice(country.dial.length);
    if (national.length > Math.max(...country.lengths) + country.trunk.length) continue;
    return { country, national };
  }
  return null;
}

/**
 * A country plus the national number someone typed → E.164, or a reason.
 *
 * `empty` and `invalid` are the server's own words (`requirePhone` answers
 * `phone_required`/`invalid_phone`), so the login page maps one vocabulary to one
 * set of dictionary keys.
 */
export function normalizeCountryPhone(
  country: Country,
  input: string,
): { ok: true; phone: string } | { ok: false; reason: "empty" | "invalid" } {
  const digits = toAsciiDigits(String(input ?? "")).replace(/\D/g, "");
  if (!digits) return { ok: false, reason: "empty" };

  // The whole number, dial code and all, is accepted too: pasting is how most
  // people enter a number they have saved somewhere.
  let national = digits;
  if (national.startsWith(country.dial) && national.length > country.dial.length) {
    const rest = national.slice(country.dial.length);
    if (country.lengths.includes(rest.length)) national = rest;
  }

  // With and without the trunk prefix, in that order: `0912…` and `912…` are the
  // same Iranian number, and `8 912…` is the Russian one.
  const candidates = [national];
  if (country.trunk && national.startsWith(country.trunk)) {
    candidates.push(national.slice(country.trunk.length));
  }

  for (const candidate of candidates) {
    if (!country.lengths.includes(candidate.length)) continue;
    // A national number never keeps the trunk prefix, and a leading zero after it
    // means the prefix was already dropped.
    if (candidate.startsWith("0")) continue;
    if (country.pattern && !country.pattern.test(candidate)) continue;
    return { ok: true, phone: `+${country.dial}${candidate}` };
  }
  return { ok: false, reason: "invalid" };
}
