import { useLayoutEffect, useMemo, useRef, type ChangeEvent } from "react";
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
    <div className="mt-6 flex gap-2" dir="ltr">
      <select
        className="select max-w-[11rem] shrink-0 py-[.85rem]"
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
      <input
        ref={inputRef}
        className="field min-w-0 flex-1 text-center tracking-widest"
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
