/**
 * Number parsing and display formatting.
 *
 * Everything in this module is pure: no DOM, no globals. That makes it the
 * cheapest layer to unit-test and the safest one to reuse from new features.
 */

const SUFFIX_MULTIPLIERS = { k: 1e3, m: 1e6, b: 1e9 };

/** Matches "1,234", "12,345,678" — comma used as a thousands separator. */
const COMMA_GROUPED = /^\d{1,3}(,\d{3})+$/;
/** Matches "1.234", "12.345.678" — dot used as a thousands separator. */
const DOT_GROUPED = /^\d{1,3}(\.\d{3})+$/;

/**
 * Parse a user-typed amount into a whole number of gp.
 *
 * Accepts the shorthand players actually type: `10k`, `1.5m`, `2b`, `1,234`,
 * `1.234` (dot-grouped thousands), `250 gp`. Anything unparseable becomes 0 so
 * a bad keystroke can never poison the stored state with NaN.
 *
 * @param {unknown} input
 * @returns {number} a finite integer (may be negative)
 */
export function parseAmount(input) {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input) : 0;
  }
  if (input === null || input === undefined) return 0;

  let text = String(input).trim().toLowerCase();
  if (!text) return 0;

  // Strip currency noise: "250 gp", "1,000 coins".
  text = text.replace(/\s+/g, '').replace(/gp$|coins?$/, '');
  if (!text) return 0;

  let sign = 1;
  if (text.startsWith('-')) {
    sign = -1;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }

  let multiplier = 1;
  const lastChar = text.at(-1);
  if (lastChar && Object.hasOwn(SUFFIX_MULTIPLIERS, lastChar)) {
    multiplier = SUFFIX_MULTIPLIERS[lastChar];
    text = text.slice(0, -1);
    // With a suffix the dot is unambiguously a decimal point ("1.5m").
    text = text.replace(/,/g, '.');
  } else {
    text = normalizeSeparators(text);
  }

  if (!text || !/^\d*\.?\d*$/.test(text)) return 0;

  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return 0;

  return Math.round(sign * value * multiplier);
}

/**
 * Decide whether `.` and `,` are grouping or decimal separators, and return a
 * string that `Number.parseFloat` understands.
 */
function normalizeSeparators(text) {
  const hasComma = text.includes(',');
  const hasDot = text.includes('.');

  if (hasComma && hasDot) {
    // Whichever appears last is the decimal separator.
    return text.lastIndexOf(',') > text.lastIndexOf('.')
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  }
  if (hasComma) {
    return COMMA_GROUPED.test(text) ? text.replace(/,/g, '') : text.replace(',', '.');
  }
  if (hasDot) {
    return DOT_GROUPED.test(text) ? text.replace(/\./g, '') : text;
  }
  return text;
}

/**
 * Clamp a value to a non-negative whole number. Used for quantities and prices
 * that have no meaningful negative reading.
 */
export function toNonNegativeInt(input) {
  const value = parseAmount(input);
  return value > 0 ? value : 0;
}

/** `1234567` -> `"1,234,567"`. Non-finite input renders as `"0"`. */
export function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return Math.round(number).toLocaleString('en-US');
}

/** `1234` -> `"+1,234"`, `-5` -> `"-5"`, `0` -> `"0"`. */
export function formatSigned(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.round(number) === 0) return '0';
  const rounded = Math.round(number);
  return (rounded > 0 ? '+' : '') + rounded.toLocaleString('en-US');
}

/** `1500000` -> `"1.5M"`. For tight spaces like stat cards. */
export function formatCompact(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';

  const sign = number < 0 ? '-' : '';
  const abs = Math.abs(number);

  if (abs < 1e4) return sign + Math.round(abs).toLocaleString('en-US');
  if (abs < 1e6) return `${sign}${trimZero(abs / 1e3)}K`;
  if (abs < 1e9) return `${sign}${trimZero(abs / 1e6)}M`;
  return `${sign}${trimZero(abs / 1e9)}B`;
}

function trimZero(value) {
  return value.toFixed(1).replace(/\.0$/, '');
}

/**
 * Render a duration given in hours as `"3h 24m"`.
 * Under an hour the hour segment is dropped; zero renders as `"0m"`.
 */
export function formatDuration(hours) {
  const number = Number(hours);
  if (!Number.isFinite(number) || number <= 0) return '0m';

  const totalMinutes = Math.round(number * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;

  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** `0.1234` -> `"12.3%"`. */
export function formatPercent(ratio) {
  const number = Number(ratio);
  if (!Number.isFinite(number)) return '0%';
  return `${(number * 100).toFixed(1)}%`;
}
