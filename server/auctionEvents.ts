type AuctionUpdateListener = () => void;

const listenersByListing = new Map<string, Set<AuctionUpdateListener>>();

export function subscribeAuctionUpdates(listingId: string, listener: AuctionUpdateListener): () => void {
  const listeners = listenersByListing.get(listingId) ?? new Set<AuctionUpdateListener>();
  listeners.add(listener);
  listenersByListing.set(listingId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByListing.delete(listingId);
  };
}

export function publishAuctionUpdate(listingId: string): void {
  for (const listener of listenersByListing.get(listingId) ?? []) listener();
}
