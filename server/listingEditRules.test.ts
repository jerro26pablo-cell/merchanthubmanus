import { describe, expect, it } from "vitest";
import { listingTypeChangeBlock } from "./listingEditRules";

describe("listing type edit safety", () => {
  it("allows active or draft listings without bid history", () => {
    expect(listingTypeChangeBlock("draft", false)).toBeNull();
    expect(listingTypeChangeBlock("official", false)).toBeNull();
  });

  it("protects listings with bids and closed inventory", () => {
    expect(listingTypeChangeBlock("official", true)).toBe("bids");
    expect(listingTypeChangeBlock("auction-ended", false)).toBe("closed");
    expect(listingTypeChangeBlock("sold", false)).toBe("closed");
    expect(listingTypeChangeBlock("deleted", false)).toBe("closed");
  });
});
