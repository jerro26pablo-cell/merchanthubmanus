export type AuctionBidState = {
  id: number;
  userId: number;
  maxBidCents: number;
  currentBidCents: number;
  incrementCents?: number;
  status: "active" | "won" | "outbid" | "offered" | "cancelled";
  createdAt: Date | string;
};

export type ExpiredAuctionOutcome =
  | { kind: "sold"; winner: AuctionBidState }
  | { kind: "no-sale"; winner: null };

export type AuctionPhase = "scheduled" | "live" | "ended";

export function getAuctionPhase(startAt: Date | string | null | undefined, endAt: Date | string | null | undefined, now = new Date()): AuctionPhase {
  const start = startAt == null ? null : new Date(startAt).getTime();
  const end = endAt == null ? null : new Date(endAt).getTime();
  if (start != null && start > now.getTime()) return "scheduled";
  if (end != null && end <= now.getTime()) return "ended";
  return "live";
}

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

/** Pick each bidder's latest eligible cap, retaining old caps and first-to-cap priority. */
export function rankCurrentProxyBids(bids: AuctionBidState[]): AuctionBidState[] {
  const chronological = [...bids].sort((a, b) => {
    const timeDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return timeDelta || a.id - b.id;
  });
  const latestByUser = new Map<number, AuctionBidState>();
  const currentCapByUser = new Map<number, number>();
  const capPriorityByUser = new Map<number, number>();
  for (const bid of chronological) {
    latestByUser.set(bid.userId, bid);
    if (bid.status === "cancelled" || bid.status === "won") {
      currentCapByUser.delete(bid.userId);
      capPriorityByUser.delete(bid.userId);
      continue;
    }
    if (currentCapByUser.get(bid.userId) !== bid.maxBidCents) {
      currentCapByUser.set(bid.userId, bid.maxBidCents);
      capPriorityByUser.set(bid.userId, bid.id);
    }
  }
  return [...latestByUser.values()]
    .filter((bid) => bid.status === "active" || bid.status === "outbid")
    .sort((a, b) => b.maxBidCents - a.maxBidCents || (capPriorityByUser.get(a.userId) ?? a.id) - (capPriorityByUser.get(b.userId) ?? b.id));
}

/** First bids must clear the opening amount by one seller increment; later bids advance from the live price. */
export function getMinimumNextBidCents(currentBidCents: number, openingBidCents: number, sellerMinimumIncrementCents: number, hasBids: boolean): number {
  return (hasBids ? currentBidCents : openingBidCents) + Math.max(100, sellerMinimumIncrementCents);
}

/** Determine the price reached by proxy bidding, bounded by the leading bidder's cap. */
export function calculateProxyWinningBidCents(
  leader: AuctionBidState,
  runnerUp: AuctionBidState | undefined,
  submittedBidCents: number,
  openingBidCents: number,
  sellerMinimumIncrementCents: number,
): number {
  const increment = Math.max(100, sellerMinimumIncrementCents, leader.incrementCents ?? sellerMinimumIncrementCents);
  const runnerUpPrice = runnerUp ? runnerUp.maxBidCents + increment : openingBidCents;
  return Math.min(leader.maxBidCents, Math.max(openingBidCents, submittedBidCents, runnerUpPrice));
}

export type ProxyBidLadderParticipant = { proxyBidId: number; userId: number; maxBidCents: number; incrementCents: number };
export type ProxyBidLadderEvent = { proxyBidId: number; userId: number; amountCents: number; kind: "submitted" | "automatic" };

/** Expand a proxy result into the alternating, public price steps buyers would see. */
export function buildProxyBidLadderEvents(
  submitted: ProxyBidLadderParticipant,
  opponent: ProxyBidLadderParticipant | undefined,
  winningUserId: number,
  submittedBidCents: number,
  winningBidCents: number,
  sellerMinimumIncrementCents: number,
): ProxyBidLadderEvent[] {
  const events: ProxyBidLadderEvent[] = [{ proxyBidId: submitted.proxyBidId, userId: submitted.userId, amountCents: submittedBidCents, kind: "submitted" }];
  if (!opponent || winningBidCents <= submittedBidCents) return events;
  const participants = new Map<number, ProxyBidLadderParticipant>([[submitted.userId, submitted], [opponent.userId, opponent]]);
  const otherUserId = (userId: number) => userId === submitted.userId ? opponent.userId : submitted.userId;
  const winner = participants.get(winningUserId) ?? submitted;
  const stepCents = Math.max(100, sellerMinimumIncrementCents, winner.incrementCents);
  let current = submittedBidCents;
  let turnUserId = winningUserId === submitted.userId ? opponent.userId : submitted.userId;
  let steps = 0;
  while (current < winningBidCents && steps < 1000) {
    let actor = participants.get(turnUserId);
    if (!actor || actor.maxBidCents <= current) {
      turnUserId = otherUserId(turnUserId);
      actor = participants.get(turnUserId);
      if (!actor || actor.maxBidCents <= current) break;
    }
    const next = Math.min(current + stepCents, actor.maxBidCents, winningBidCents);
    if (next <= current) break;
    events.push({ proxyBidId: actor.proxyBidId, userId: actor.userId, amountCents: next, kind: "automatic" });
    current = next;
    turnUserId = otherUserId(actor.userId);
    steps += 1;
  }
  if (current < winningBidCents) events.push({ proxyBidId: winner.proxyBidId, userId: winner.userId, amountCents: winningBidCents, kind: "automatic" });
  return events;
}

/** Keep bidder labels stable and unique even when multiple accounts share the same name. */
export function createBidderLabels(userIds: number[], viewerUserId: number): Map<number, string> {
  const others = [...new Set(userIds)].filter((id) => id !== viewerUserId);
  const labels = new Map<number, string>([[viewerUserId, "You"]]);
  others.forEach((id, index) => labels.set(id, `Bidder ${index + 1}`));
  return labels;
}

/** Return a real winner, current leader, or pending offer; never label an outbid row as a winner. */
export function selectAuctionSummaryBid(bids: AuctionBidState[]): AuctionBidState | null {
  const priority = (status: AuctionBidState["status"]) => status === "won" ? 0 : status === "active" ? 1 : status === "offered" ? 2 : 3;
  return [...bids].sort((a, b) => priority(a.status) - priority(b.status) || b.currentBidCents - a.currentBidCents || b.maxBidCents - a.maxBidCents || a.id - b.id).find((bid) => ["won", "active", "offered"].includes(bid.status)) ?? null;
}

/** Pick the next eligible bidder by latest per-user cap, preserving first-to-cap ties. */
export function selectSecondChanceBid(
  bids: AuctionBidState[],
  cancelledWinnerUserId: number,
): AuctionBidState | null {
  return rankCurrentProxyBids(bids).find((bid) => bid.userId !== cancelledWinnerUserId && bid.status === "outbid") ?? null;
}

export function secondChanceTransition(action: "accept" | "decline") {
  return action === "accept"
    ? { bidStatus: "won" as const, listingLifecycle: "sold" as const }
    : { bidStatus: "cancelled" as const, listingLifecycle: "canceled" as const };
}

export type WinnerCancellationDecision =
  | { allowed: false; reason: "seller-policy" | "delivery-started"; refundCents: 0 }
  | { allowed: true; reason: null; refundCents: number };

/** Voluntary cancellation is policy-gated and only reverses a still-processing e-wallet order. */
export function resolveWinnerCancellation(
  cancellationAllowed: boolean,
  orderStatus: string | null,
  payment: string | null,
  amountCents: number,
): WinnerCancellationDecision {
  if (!cancellationAllowed) return { allowed: false, reason: "seller-policy", refundCents: 0 };
  if (orderStatus != null && orderStatus !== "Processing") return { allowed: false, reason: "delivery-started", refundCents: 0 };
  return { allowed: true, reason: null, refundCents: orderStatus === "Processing" && payment === "E-wallet" ? Math.max(0, Math.round(amountCents)) : 0 };
}
