export type ListingTypeChangeBlock = "closed" | "bids" | null;

export function listingTypeChangeBlock(lifecycle: string, hasBidHistory: boolean): ListingTypeChangeBlock {
  if (lifecycle !== "draft" && lifecycle !== "official") return "closed";
  if (hasBidHistory) return "bids";
  return null;
}
