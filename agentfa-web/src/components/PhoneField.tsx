import { useLayoutEffect, useMemo, useRef, type ChangeEvent } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "../lib/i18n";
import {
  COUNTRIES,
  IRAN,
  localizeDigits,
  matchInternational,
  toAsciiDigits,
  type Country,
} from "../lib/phone";

/**
 * Country code picker plus a mobile-number field.
 *
 * The number is held as ASCII digits and *displayed* in the language's own digits,
 * so Persian readers see `۰۹۱۲…` while what we store and send stays `+98912…`. The
 * alternative — storing what is on screen — freezes the number in whichever script
 * was showing when it was typed, the same way storing a translated string freezes
 * a message in the language that failed.
 */

/** E.164 stops at fifteen digits; nothing longer is worth keeping in the field. */
const MAX_DIGITS = 15;

/**
 * Bidi isolates around the dial code.
 *
 * In a Persian label the `+` is a neutral character between an RTL name and a
 * number, so the browser resolves it *into* the RTL run and the code renders as
 * `49+` — the opposite of how it is written. Wrapping it in an LTR isolate keeps
 * `+49` in one piece in both dictionaries, and the characters are invisible.
 */
const LRI = "\u2066";
const PDI = "\u2069";

/**
 * The flag as emoji, from an ISO 3166-1 alpha-2 code: the two letters turn into
 * the regional-indicator pair that fonts draw as a flag (`IR` → 🇮🇷). No image
 * files, no dependency, and `flagsRenderInColor` below decides whether this is
 * worth using at all.
 */
function flagFor(iso: string): string {
  const letters = iso.toUpperCase();
  return String.fromCodePoint(...[...letters].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
}

/**
 * Does this platform actually draw a color flag for that pair?
 *
 * Apple, Android and Linux do. Windows keeps the two regional indicators as plain
 * letter glyphs, so `🇮🇷` lands there as a shrunken "IR" — a half-rendered flag
 * slot. Rather than guess, paint one pair into a canvas once and look at it: a
 * flag fills the glyph with saturated color, letters stay one flat tone. The
 * answer is cached, so the picker shows a real flag where flags exist and a
 * deliberate ISO badge where they do not.
 */
let flagSupport: boolean | null = null;
function flagsRenderInColor(): boolean {
  if (flagSupport !== null) return flagSupport;
  flagSupport = false;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) return flagSupport;
    context.font = '48px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    context.textBaseline = "top";
    context.fillStyle = "#fff";
    context.fillText("\u{1F1EE}\u{1F1F7}", 2, 4);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let opaque = 0;
    let colored = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] <= 40) continue;
      opaque += 1;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (Math.max(r, g, b) - Math.min(r, g, b) > 40) colored += 1;
    }
    flagSupport = opaque > 0 && colored / opaque > 0.35;
  } catch {
    // No canvas, no measurement: letters are the safe answer.
    flagSupport = false;
  }
  return flagSupport;
}

type PhoneFieldProps = {
  country: Country;
  onCountryChange: (country: Country) => void;
  /** ASCII digits of the national number — no dial code, no trunk prefix. */
  value: string;
  onValueChange: (digits: string) => void;
  /** The element explaining a validation failure, for screen readers. */
  describedBy?: string;
};

export function PhoneField({
  country,
  onCountryChange,
  value,
  onValueChange,
  describedBy,
}: PhoneFieldProps) {
  const { t, lang } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const showFlag = flagsRenderInColor();

  // Iran first, then the rest in the order of the language on screen: a Persian
  // reader scans Persian names, an English reader English ones.
  const options = useMemo(() => {
    const rest = COUNTRIES.filter((c) => c.iso !== IRAN.iso).sort((a, b) =>
      (lang === "fa" ? a.fa : a.en).localeCompare(lang === "fa" ? b.fa : b.en, lang),
    );
    return [IRAN, ...rest];
  }, [lang]);

  // Localizing digits is a one-for-one replacement, so the caret's index in the
  // displayed value is also its index in the digits — restoring it keeps editing
  // in the middle of a number from jumping to the end.
  useLayoutEffect(() => {
    const node = inputRef.current;
    if (!node || caret.current === null) return;
    node.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  function change(event: ChangeEvent<HTMLInputElement>) {
    const raw = toAsciiDigits(event.target.value);
    // A whole number pasted in with its country code: follow it to that country
    // rather than complaining about the digits.
    const pasted = matchInternational(raw);
    if (pasted) {
      onCountryChange(pasted.country);
      onValueChange(pasted.national.slice(0, MAX_DIGITS));
      caret.current = null;
      return;
    }
    const digitsBefore = raw.slice(0, event.target.selectionStart ?? raw.length).replace(/\D/g, "").length;
    const digits = raw.replace(/\D/g, "").slice(0, MAX_DIGITS);
    onValueChange(digits);
    caret.current = Math.min(digitsBefore, digits.length);
  }

  return (
    <div className="phone-combo mt-6" dir="ltr">
      <div className="phone-combo__country">
        {/* The real control, stretched over the segment and left invisible: the
            native list, its keyboard handling and its screen-reader semantics are
            all worth more than a hand-built popover. */}
        <select
          className="phone-combo__select"
          value={country.iso}
          onChange={(event) => {
            const next = COUNTRIES.find((c) => c.iso === event.target.value);
            if (next) onCountryChange(next);
          }}
          aria-label={t("auth.countryCode")}
        >
          {options.map((option) => (
            <option key={option.iso} value={option.iso}>
              {lang === "fa" ? option.fa : option.en} {LRI}+{option.dial}{PDI}
            </option>
          ))}
        </select>
        {/* What the select cannot draw: a flag, the bare dial code, and a chevron
            that is ours rather than the platform's. Hidden from assistive tech
            because the select above already announces all of it. */}
        <span className="phone-combo__face" aria-hidden="true">
          <span className={`phone-combo__flag${showFlag ? "" : " phone-combo__flag--code"}`}>
            {showFlag ? flagFor(country.iso) : country.iso}
          </span>
          <span className="phone-combo__dial">{LRI}+{country.dial}{PDI}</span>
          <ChevronDown className="phone-combo__chevron" size={14} />
        </span>
      </div>
      <input
        ref={inputRef}
        className="phone-combo__input"
        dir="ltr"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={localizeDigits(value, lang)}
        onChange={change}
        // The placeholder is the country's own mobile example, so the expected
        // shape is visible before anything is typed.
        placeholder={localizeDigits(country.example, lang)}
        aria-label={t("auth.phone")}
        aria-describedby={describedBy}
        required
      />
    </div>
  );
}
