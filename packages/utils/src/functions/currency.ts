const DEFAULT_CURRENCY = 'USD';
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

/** Locale-aware currency formatter for course prices. */
export function getCurrencyFormatter(currency: string | undefined = DEFAULT_CURRENCY) {
  const normalizedCurrency = currency.trim().toUpperCase() || DEFAULT_CURRENCY;
  const currencyCode = CURRENCY_CODE_PATTERN.test(normalizedCurrency) ? normalizedCurrency : DEFAULT_CURRENCY;
  const locale = currencyCode === 'NGN' ? 'en-NG' : 'en-US';

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2
  });
}
