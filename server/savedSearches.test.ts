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

  it("honors saved listing type, category, and exact store location filters", () => {
    expect(matchesSavedSearch({ query: "hoodie", filter: "Fashion", province: "South Cotabato", municipality: "Polomolok" }, listing, polomolok)).toBe(true);
    expect(matchesSavedSearch({ query: "hoodie", filter: "Auction" }, listing, polomolok)).toBe(false);
    expect(matchesSavedSearch({ query: "hoodie", filter: "All items", province: "South Cotabato", municipality: "Tupi" }, listing, polomolok)).toBe(false);
    expect(matchesSavedSearch({ query: "hoodie", filter: "All items", province: "Davao del Sur" }, listing, polomolok)).toBe(false);
  });
});
