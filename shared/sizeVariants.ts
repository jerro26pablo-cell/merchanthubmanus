export const COLOR_OPTIONS = ["Black", "White", "Gray", "Red", "Blue", "Green", "Yellow", "Pink", "Purple", "Orange", "Brown", "Beige", "Navy", "Multicolor"] as const;

export const SIZE_OPTIONS = [
  "XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL", "8XL", "One size", "Other",
] as const;

export type ListingType = "Auction" | "Buy now";
export type SizeVariantRow = { size: string; color: string; priceCents: number; stock: number };

/** Validate seller-supplied size rows before persistence. "Other" should be replaced by the seller's own label. */
export function normalizeSizeVariants(input: unknown, listingType: ListingType): SizeVariantRow[] {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error("Size options must be a list.");
  if (input.length > 64) throw new Error("A listing can have at most 64 size/color combinations.");
  if (listingType === "Auction" && input.length > 1) throw new Error("An auction can include only one size. Create separate auctions for different sizes.");

  const seen = new Set<string>();
  return input.map((value, index) => {
    if (!value || typeof value !== "object") throw new Error(`Size option ${index + 1} is invalid.`);
    const raw = value as Record<string, unknown>;
    const size = String(raw.size ?? "").trim();
    const color = String(raw.color ?? "").trim();
    const priceCents = Number(raw.priceCents);
    const stock = Number(raw.stock);
    if (!size || size.length > 32) throw new Error(`Enter a size label of 1–32 characters for option ${index + 1}.`);
    if (color.length > 40) throw new Error(`Enter a color label no longer than 40 characters for ${size}.`);
    const key = `${size.toLocaleLowerCase()}\u0000${color.toLocaleLowerCase()}`;
    if (seen.has(key)) throw new Error(`The size/color combination “${size}${color ? ` · ${color}` : ""}” is listed more than once.`);
    seen.add(key);
    if (!Number.isSafeInteger(priceCents) || priceCents <= 0) throw new Error(`Enter a valid positive price for size ${size}.`);
    if (!Number.isSafeInteger(stock) || stock < 0) throw new Error(`Enter a whole-number stock quantity of zero or more for size ${size}.`);
    return { size, color, priceCents, stock };
  });
}

export function totalVariantStock(variants: SizeVariantRow[]): number {
  return variants.reduce((total, variant) => total + variant.stock, 0);
}

export function lowestAvailableVariantPrice(variants: SizeVariantRow[]): number | null {
  const available = variants.filter((variant) => variant.stock > 0).map((variant) => variant.priceCents);
  return available.length ? Math.min(...available) : null;
}
