import { describe, expect, it } from "vitest";
import { matchesSavedSearch } from "./savedSearches";

describe("saved search matching", () => {
  const listing = { title: "Soft cotton hoodie", description: "Warm charcoal pullover", category: "Fashion", listingType: "Buy now" };
  const polomolok = { province: "South Cotabato", municipality: "Polomolok" };

  it("matches new listings by saved item keyword across title and description", () => {
    expect(matchesSavedSearch({ query: "hoodie", filter: "All items" }, listing, polomolok)).toBe(true);
    expect(matchesSavedSearch({ query: "charcoal hoodie", filter: "All items" }, listing, polomolok)).toBe(true);
    expect(matchesSavedSearch({ query: "camera", filter: "All items" }, listing, polomolok)).toBe(false);
  });

  it("lets an unrestricted All items search match future listings everywhere", () => {
    expect(matchesSavedSearch({ query: "", filter: "All items" }, listing, polomolok)).toBe(true);
    expect(matchesSavedSearch({ query: "", filter: "All items" }, { title: "Desk lamp", description: "LED reading light", category: "Home", listingType: "Auction" }, { province: "Cebu", municipality: "Cebu City" })).toBe(true);
  });

  it("matches an All locations size search against available sizes", () => {
    const hoodieSizes = { ...listing, variants: [{ size: "M", color: "Black" }, { size: "2XL", color: "White" }] };
    expect(matchesSavedSearch({ query: "", filter: "All items", size: "2XL" }, hoodieSizes, { province: "Cebu", municipality: "Cebu City" })).toBe(true);
    expect(matchesSavedSearch({ query: "", filter: "All items", size: "XL" }, hoodieSizes, { province: "Cebu", municipality: "Cebu City" })).toBe(false);
    expect(matchesSavedSearch({ query: "", filter: "All items" }, hoodieSizes, polomolok)).toBe(true);
  });

  it("matches color with the selected size on the same available combination", () => {
    const hoodieVariants = { ...listing, variants: [{ size: "M", color: "Black" }, { size: "L", color: "White" }] };
    expect(matchesSavedSearch({ query: "", filter: "All items", size: "M", color: "Black" }, hoodieVariants, polomolok)).toBe(true);
    expect(matchesSavedSearch({ query: "", filter: "All items", size: "M", color: "White" }, hoodieVariants, polomolok)).toBe(false);
    expect(matchesSavedSearch({ query: "", filter: "All items", color: "White" }, hoodieVariants, polomolok)).toBe(true);
  });

  it("honors saved listing type, category, and exact store location filters", () => {
    expect(matchesSavedSearch({ query: "hoodie", filter: "Fashion", province: "South Cotabato", municipality: "Polomolok" }, listing, polomolok)).toBe(true);
    expect(matchesSavedSearch({ query: "hoodie", filter: "Auction" }, listing, polomolok)).toBe(false);
    expect(matchesSavedSearch({ query: "hoodie", filter: "All items", province: "South Cotabato", municipality: "Tupi" }, listing, polomolok)).toBe(false);
    expect(matchesSavedSearch({ query: "hoodie", filter: "All items", province: "Davao del Sur" }, listing, polomolok)).toBe(false);
  });
});
