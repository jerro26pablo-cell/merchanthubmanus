import { describe, expect, it } from "vitest";
import { normalizeSizeVariants, SIZE_OPTIONS, totalVariantStock, lowestAvailableVariantPrice } from "../shared/sizeVariants";

describe("size variants", () => {
  it("offers sizes beyond XL and supports a seller-entered custom label", () => {
    expect(SIZE_OPTIONS).toContain("2XL");
    expect(SIZE_OPTIONS).toContain("8XL");
    expect(SIZE_OPTIONS).toContain("Other");
    expect(normalizeSizeVariants([{ size: "9XL", color: "", priceCents: 129900, stock: 2 }], "Buy now")).toEqual([{ size: "9XL", color: "", priceCents: 129900, stock: 2 }]);
  });

  it("keeps each size/color combination price and stock separate while deriving totals", () => {
    const variants = normalizeSizeVariants([
      { size: "M", color: "Black", priceCents: 10000, stock: 2 },
      { size: "M", color: "White", priceCents: 10500, stock: 1 },
      { size: "XL", priceCents: 11500, stock: 0 },
      { size: "2XL", color: "Navy", priceCents: 12500, stock: 3 },
    ], "Buy now");
    expect(totalVariantStock(variants)).toBe(6);
    expect(lowestAvailableVariantPrice(variants)).toBe(10000);
  });

  it("allows one size in multiple colors but rejects duplicate size/color pairs", () => {
    expect(normalizeSizeVariants([{ size: "M", color: "Black", priceCents: 10000, stock: 1 }, { size: "M", color: "White", priceCents: 11000, stock: 2 }], "Buy now")).toHaveLength(2);
    expect(() => normalizeSizeVariants([
      { size: "2XL", color: "Blue", priceCents: 10000, stock: 1 },
      { size: "2xl", color: "blue", priceCents: 11000, stock: 1 },
    ], "Buy now")).toThrow("listed more than once");
  });

  it("limits an auction to the one exact size being auctioned", () => {
    expect(() => normalizeSizeVariants([
      { size: "M", priceCents: 10000, stock: 1 },
      { size: "L", priceCents: 10000, stock: 1 },
    ], "Auction")).toThrow("only one size");
  });

  it("rejects a missing size, invalid price, or fractional stock", () => {
    expect(() => normalizeSizeVariants([{ size: "", priceCents: 10000, stock: 1 }], "Buy now")).toThrow("size label");
    expect(() => normalizeSizeVariants([{ size: "M", priceCents: 0, stock: 1 }], "Buy now")).toThrow("valid positive price");
    expect(() => normalizeSizeVariants([{ size: "M", priceCents: 10000, stock: 1.5 }], "Buy now")).toThrow("whole-number");
  });
});
