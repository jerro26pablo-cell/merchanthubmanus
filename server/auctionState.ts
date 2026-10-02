export type AuctionBidState = {
  id: number;
  userId: number;
  maxBidCents: number;
  currentBidCents: number;
  status: "active" | "won" | "outbid" | "offered" | "cancelled";
  createdAt: Date | string;
};

export type ExpiredAuctionOutcome =
  | { kind: "sold"; winner: AuctionBidState }
  | { kind: "no-sale"; winner: null };

/** Resolve the durable result of an ended auction, including legacy won rows. */
export function resolveExpiredAuctionOutcome(
  bids: AuctionBidState[],
  reserveThresholdCents: number | null,
  availableStock: number,
): ExpiredAuctionOutcome {
  const alreadyWon = bids
    .filter((bid) => bid.status === "won")
    .sort((a, b) => b.currentBidCents - a.currentBidCents || a.id - b.id)[0];
  if (alreadyWon) return { kind: "sold", winner: alreadyWon };

  const leadingBid = bids
    .filter((bid) => bid.status === "active")
    .sort((a, b) => b.currentBidCents - a.currentBidCents || b.maxBidCents - a.maxBidCents || a.id - b.id)[0];
  if (!leadingBid || availableStock <= 0) return { kind: "no-sale", winner: null };
  if (reserveThresholdCents != null && reserveThresholdCents > 0 && leadingBid.currentBidCents < reserveThresholdCents) {
    return { kind: "no-sale", winner: null };
  }
  return { kind: "sold", winner: leadingBid };
}

/** Return a real winner, current leader, or pending offer; never label an outbid row as a winner. */
export function selectAuctionSummaryBid(bids: AuctionBidState[]): AuctionBidState | null {
  const priority = (status: AuctionBidState["status"]) => status === "won" ? 0 : status === "active" ? 1 : status === "offered" ? 2 : 3;
  return [...bids].sort((a, b) => priority(a.status) - priority(b.status) || b.currentBidCents - a.currentBidCents || b.maxBidCents - a.maxBidCents || a.id - b.id).find((bid) => ["won", "active", "offered"].includes(bid.status)) ?? null;
}

/** Pick the next eligible bidder by latest per-user bid, then highest proxy cap. */
export function selectSecondChanceBid(
  bids: AuctionBidState[],
  cancelledWinnerUserId: number,
): AuctionBidState | null {
  const newestFirst = [...bids].sort((a, b) => {
    const timeDelta = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return timeDelta || b.id - a.id;
  });
  const latestByUser = new Map<number, AuctionBidState>();
  for (const bid of newestFirst) {
    if (!latestByUser.has(bid.userId)) latestByUser.set(bid.userId, bid);
  }
  return [...latestByUser.values()]
    .filter((bid) => bid.userId !== cancelledWinnerUserId && bid.status === "outbid")
    .sort((a, b) => b.maxBidCents - a.maxBidCents || a.id - b.id)[0] ?? null;
}

export function secondChanceTransition(action: "accept" | "decline") {
  return action === "accept"
    ? { bidStatus: "won" as const, listingLifecycle: "sold" as const }
    : { bidStatus: "cancelled" as const, listingLifecycle: "auction-ended" as const };
}
