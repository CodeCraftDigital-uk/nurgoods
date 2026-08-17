/**
 * Single source of truth for every customer facing price presentation.
 *
 * Every surface (cards, product page, basket, related products, previews)
 * must build its price strings here so a product can never show two
 * conflicting prices at once. Nothing in this module invents a price: a value
 * is only rendered when the synced store data supplies it.
 */

export const DEFAULT_CURRENCY = "GBP";

export interface PriceDisplay {
  /** The one price string a surface is allowed to show as the main price. */
  primary: string | null;
  /** Struck through original price, only when a genuine saving applies. */
  compareAt: string | null;
  /** Whole percent saved, only when compareAt is present. */
  savingPercent: number | null;
  /** True when the primary string covers several variant prices. */
  isRange: boolean;
  /** Lowest price behind the display, for sorting and structured data. */
  amount: number | null;
  currency: string;
}

const EMPTY: PriceDisplay = {
  primary: null,
  compareAt: null,
  savingPercent: null,
  isRange: false,
  amount: null,
  currency: DEFAULT_CURRENCY,
};

function isMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Formats one amount in store currency, always with the minor units shown. */
export function formatMoney(value: number, currency: string | null = DEFAULT_CURRENCY): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency ?? DEFAULT_CURRENCY,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Rounds a whole percent saving, or null when the saving is not genuine. */
export function savingPercent(price: number, compareAt: number): number | null {
  if (!isMoney(price) || !isMoney(compareAt) || compareAt <= price) return null;
  const percent = Math.round(((compareAt - price) / compareAt) * 100);
  return percent > 0 ? percent : null;
}

export interface PriceRangeInput {
  price_min: number | null;
  price_max: number | null;
  currency: string | null;
  compare_at_price_min?: number | null;
  variant_count?: number;
}

/**
 * Price shown before a variant is chosen.
 *
 * When several variants differ in price the range is the only price shown: a
 * range plus a compare at value cannot be compared like for like, so the
 * struck through price is deliberately withheld until a variant is selected.
 */
export function productPriceDisplay(
  product: PriceRangeInput,
  options: { rangeStyle?: "range" | "from" } = {},
): PriceDisplay {
  const currency = product.currency ?? DEFAULT_CURRENCY;
  const min = isMoney(product.price_min) ? product.price_min : null;
  const max = isMoney(product.price_max) ? product.price_max : null;
  if (min == null && max == null) return { ...EMPTY, currency };

  const low = min ?? (max as number);
  const high = max ?? (min as number);
  const isRange = high > low;

  if (isRange) {
    return {
      primary:
        options.rangeStyle === "from"
          ? `From ${formatMoney(low, currency)}`
          : `${formatMoney(low, currency)} to ${formatMoney(high, currency)}`,
      compareAt: null,
      savingPercent: null,
      isRange: true,
      amount: low,
      currency,
    };
  }

  const compare = isMoney(product.compare_at_price_min) ? product.compare_at_price_min : null;
  const percent = compare != null ? savingPercent(low, compare) : null;
  return {
    primary: formatMoney(low, currency),
    compareAt: percent != null ? formatMoney(compare as number, currency) : null,
    savingPercent: percent,
    isRange: false,
    amount: low,
    currency,
  };
}

export interface VariantPriceInput {
  price: number | null;
  compare_at_price?: number | null;
  currency?: string | null;
}

/** Exact price of the selected variant. Replaces the range once chosen. */
export function variantPriceDisplay(
  variant: VariantPriceInput,
  fallbackCurrency: string | null = DEFAULT_CURRENCY,
): PriceDisplay {
  const currency = variant.currency ?? fallbackCurrency ?? DEFAULT_CURRENCY;
  if (!isMoney(variant.price)) return { ...EMPTY, currency };
  const compare = isMoney(variant.compare_at_price) ? variant.compare_at_price : null;
  const percent = compare != null ? savingPercent(variant.price, compare) : null;
  return {
    primary: formatMoney(variant.price, currency),
    compareAt: percent != null ? formatMoney(compare as number, currency) : null,
    savingPercent: percent,
    isRange: false,
    amount: variant.price,
    currency,
  };
}

/**
 * Price for a product page: the selected variant when there is one, otherwise
 * the range. Only ever one presentation, never both concatenated.
 */
export function resolvePriceDisplay(
  product: PriceRangeInput,
  variant: VariantPriceInput | null | undefined,
  options: { rangeStyle?: "range" | "from" } = {},
): PriceDisplay {
  if (variant && isMoney(variant.price)) return variantPriceDisplay(variant, product.currency);
  return productPriceDisplay(product, options);
}

/** Line total for a basket line, using the exact selected variant price. */
export function lineTotalDisplay(
  variant: VariantPriceInput,
  quantity: number,
  fallbackCurrency: string | null = DEFAULT_CURRENCY,
): PriceDisplay {
  const currency = variant.currency ?? fallbackCurrency ?? DEFAULT_CURRENCY;
  const qty = Math.max(1, Math.trunc(quantity) || 1);
  if (!isMoney(variant.price)) return { ...EMPTY, currency };
  return variantPriceDisplay(
    {
      price: Number((variant.price * qty).toFixed(2)),
      compare_at_price: isMoney(variant.compare_at_price)
        ? Number((variant.compare_at_price * qty).toFixed(2))
        : null,
      currency,
    },
    currency,
  );
}
