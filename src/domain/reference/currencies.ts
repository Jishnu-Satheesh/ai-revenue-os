/**
 * ISO 4217 currencies offered in operator-facing pickers, with the exponent
 * needed to convert a typed major-unit amount into the integer minor units the
 * platform stores.
 */
export type CurrencyOption = {
  code: string;
  label: string;
  exponent: number;
};

export const currencyOptions: readonly CurrencyOption[] = [
  { code: "AED", label: "UAE Dirham", exponent: 2 },
  { code: "SAR", label: "Saudi Riyal", exponent: 2 },
  { code: "QAR", label: "Qatari Riyal", exponent: 2 },
  { code: "KWD", label: "Kuwaiti Dinar", exponent: 3 },
  { code: "BHD", label: "Bahraini Dinar", exponent: 3 },
  { code: "OMR", label: "Omani Rial", exponent: 3 },
  { code: "USD", label: "US Dollar", exponent: 2 },
  { code: "EUR", label: "Euro", exponent: 2 },
  { code: "GBP", label: "Pound Sterling", exponent: 2 },
  { code: "CHF", label: "Swiss Franc", exponent: 2 },
  { code: "SEK", label: "Swedish Krona", exponent: 2 },
  { code: "NOK", label: "Norwegian Krone", exponent: 2 },
  { code: "DKK", label: "Danish Krone", exponent: 2 },
  { code: "TRY", label: "Turkish Lira", exponent: 2 },
  { code: "EGP", label: "Egyptian Pound", exponent: 2 },
  { code: "ZAR", label: "South African Rand", exponent: 2 },
  { code: "NGN", label: "Nigerian Naira", exponent: 2 },
  { code: "KES", label: "Kenyan Shilling", exponent: 2 },
  { code: "INR", label: "Indian Rupee", exponent: 2 },
  { code: "PKR", label: "Pakistani Rupee", exponent: 2 },
  { code: "BDT", label: "Bangladeshi Taka", exponent: 2 },
  { code: "LKR", label: "Sri Lankan Rupee", exponent: 2 },
  { code: "SGD", label: "Singapore Dollar", exponent: 2 },
  { code: "MYR", label: "Malaysian Ringgit", exponent: 2 },
  { code: "IDR", label: "Indonesian Rupiah", exponent: 2 },
  { code: "PHP", label: "Philippine Peso", exponent: 2 },
  { code: "THB", label: "Thai Baht", exponent: 2 },
  { code: "JPY", label: "Japanese Yen", exponent: 0 },
  { code: "CNY", label: "Chinese Yuan", exponent: 2 },
  { code: "HKD", label: "Hong Kong Dollar", exponent: 2 },
  { code: "AUD", label: "Australian Dollar", exponent: 2 },
  { code: "NZD", label: "New Zealand Dollar", exponent: 2 },
  { code: "CAD", label: "Canadian Dollar", exponent: 2 },
  { code: "BRL", label: "Brazilian Real", exponent: 2 },
  { code: "MXN", label: "Mexican Peso", exponent: 2 },
];

const byCode = new Map(currencyOptions.map((option) => [option.code, option]));

export function findCurrency(code: string | null | undefined) {
  return code ? (byCode.get(code.trim().toUpperCase()) ?? null) : null;
}

export function currencyExponent(code: string | null | undefined) {
  return findCurrency(code)?.exponent ?? 2;
}

/** Converts a typed major-unit amount ("2500.50") into integer minor units. */
export function toMinorUnits(amount: string | number, code: string | null | undefined) {
  const value = typeof amount === "number" ? amount : Number.parseFloat(amount);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10 ** currencyExponent(code));
}

/** Converts stored integer minor units back into a major-unit input value. */
export function fromMinorUnits(minor: number | null | undefined, code: string | null | undefined) {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "";
  const exponent = currencyExponent(code);
  return exponent === 0 ? String(minor) : (minor / 10 ** exponent).toFixed(exponent);
}
