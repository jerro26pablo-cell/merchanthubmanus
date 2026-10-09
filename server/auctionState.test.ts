import { describe, expect, it } from "vitest";
import {
  calculateProxyWinningBidCents,
  createBidderLabels,
  getAuctionPhase,
  rankCurrentProxyBids,
  resolveExpiredAuctionOutcome,
  selectAuctionSummaryBid,
  selectSecondChanceBid,
  secondChanceTransition,
  resolveWinnerCancellation,
  type AuctionBidState,
} from "./auctionState";

const bid = (id: number, userId: number, status: AuctionBidState["status"], maxBidCents: number, currentBidCents: number, createdAt: string, incrementCents = 100): AuctionBidState => ({ id, userId, status, maxBidCents, currentBidCents, incrementCents, createdAt });

const saleBids = [
  bid(1, 101, "won", 18000, 15000, "2026-10-01T10:00:00Z"),
  bid(2, 202, "outbid", 14000, 0, "2026-10-01T10:01:00Z"),
  bid(3, 303, "outbid", 12000, 0, "2026-10-01T10:02:00Z"),
];

describe("scheduled auction phases", () => {
  const now = new Date("2026-10-02T07:00:00.000Z");

  it("stays scheduled before the start, becomes live at the start, and ends at the deadline", () => {
    expect(getAuctionPhase("2026-10-02T07:01:00.000Z", "2026-10-02T08:00:00.000Z", now)).toBe("scheduled");
    expect(getAuctionPhase("2026-10-02T07:00:00.000Z", "2026-10-02T08:00:00.000Z", now)).toBe("live");
    expect(getAuctionPhase("2026-10-02T06:00:00.000Z", "2026-10-02T07:00:00.000Z", now)).toBe("ended");
  });

  it("treats legacy auctions without a scheduled start as live until their end", () => {
    expect(getAuctionPhase(null, "2026-10-02T08:00:00.000Z", now)).toBe("live");
  });
});

describe("auction lifecycle rules", () => {
  it("retains an already recorded winner instead of generating a false no-sale outcome", () => {
    const result = resolveExpiredAuctionOutcome(saleBids, 10000, 1);
    expect(result.kind).toBe("sold");
    if (result.kind === "sold") expect(result.winner.userId).toBe(101);
  });

  it("settles the highest eligible active bidder as the winner", () => {
    const result = resolveExpiredAuctionOutcome([
      bid(1, 101, "active", 18000, 15000, "2026-10-01T10:00:00Z"),
      bid(2, 202, "active", 14000, 13500, "2026-10-01T10:01:00Z"),
    ], 10000, 1);
    expect(result.kind).toBe("sold");
    if (result.kind === "sold") expect(result.winner.userId).toBe(101);
  });

  it("ends without a sale when there are no bids, the reserve is missed, or stock is gone", () => {
    expect(resolveExpiredAuctionOutcome([], null, 1)).toEqual({ kind: "no-sale", winner: null });
    expect(resolveExpiredAuctionOutcome([bid(1, 101, "active", 8000, 8000, "2026-10-01T10:00:00Z")], 10000, 1)).toEqual({ kind: "no-sale", winner: null });
    expect(resolveExpiredAuctionOutcome([bid(1, 101, "active", 18000, 15000, "2026-10-01T10:00:00Z")], null, 0)).toEqual({ kind: "no-sale", winner: null });
  });

  it("offers the second-highest eligible bidder, not the cancelled winner or an older duplicate bid", () => {
    const rows = [
      bid(1, 101, "cancelled", 18000, 0, "2026-10-01T10:00:00Z"),
      bid(2, 202, "outbid", 15000, 0, "2026-10-01T10:01:00Z"),
      bid(3, 202, "outbid", 9000, 0, "2026-10-01T10:02:00Z"),
      bid(4, 303, "outbid", 11000, 0, "2026-10-01T10:03:00Z"),
    ];
    expect(selectSecondChanceBid(rows, 101)?.userId).toBe(303);
  });

  it("uses first-to-cap priority for equal second-chance offers", () => {
    const rows = [
      bid(1, 101, "cancelled", 20000, 0, "2026-10-01T10:00:00Z"),
      bid(2, 202, "outbid", 15000, 0, "2026-10-01T10:01:00Z"),
      bid(3, 303, "outbid", 15000, 0, "2026-10-01T10:02:00Z"),
    ];
    expect(selectSecondChanceBid(rows, 101)?.userId).toBe(202);
  });

  it("never promotes an outbid record to a false seller-side winner", () => {
    const outbidRows = [bid(2, 202, "outbid", 15000, 0, "2026-10-01T10:01:00Z"), bid(3, 303, "cancelled", 12000, 0, "2026-10-01T10:02:00Z")];
    expect(selectAuctionSummaryBid(outbidRows)).toBeNull();
  });

  it("prefers a persisted winner and reports a live offer as pending", () => {
    const rows = [bid(1, 101, "won", 18000, 15000, "2026-10-01T10:00:00Z"), bid(2, 202, "offered", 14000, 14000, "2026-10-01T10:01:00Z")];
    expect(selectAuctionSummaryBid(rows)?.status).toBe("won");
    expect(selectAuctionSummaryBid([rows[1]])?.status).toBe("offered");
  });

  it("turns an accepted offer into a sale and a declined offer into re-auctionable inventory", () => {
    expect(secondChanceTransition("accept")).toEqual({ bidStatus: "won", listingLifecycle: "sold" });
    expect(secondChanceTransition("decline")).toEqual({ bidStatus: "cancelled", listingLifecycle: "canceled" });
  });

  it("runs the cancellation and second-chance path when the seller permits cancellation", () => {
    const bids = [
      bid(1, 101, "cancelled", 18000, 0, "2026-10-01T10:00:00Z"),
      bid(2, 202, "outbid", 15000, 0, "2026-10-01T10:01:00Z"),
      bid(3, 303, "outbid", 12000, 0, "2026-10-01T10:02:00Z"),
    ];
    expect(resolveWinnerCancellation(true, null, null, 0)).toEqual({ allowed: true, reason: null, refundCents: 0 });
    expect(selectSecondChanceBid(bids, 101)?.userId).toBe(202);
    expect(secondChanceTransition("accept")).toEqual({ bidStatus: "won", listingLifecycle: "sold" });
    expect(secondChanceTransition("decline")).toEqual({ bidStatus: "cancelled", listingLifecycle: "canceled" });
  });

  it("blocks change-of-mind cancellation when the seller selected no-cancel", () => {
    expect(resolveWinnerCancellation(false, null, null, 0)).toEqual({ allowed: false, reason: "seller-policy", refundCents: 0 });
  });

  it("refunds a still-processing e-wallet order, but blocks cancellation after fulfillment starts", () => {
    expect(resolveWinnerCancellation(true, "Processing", "E-wallet", 125000)).toEqual({ allowed: true, reason: null, refundCents: 125000 });
    expect(resolveWinnerCancellation(true, "In transit", "E-wallet", 125000)).toEqual({ allowed: false, reason: "delivery-started", refundCents: 0 });
    expect(resolveWinnerCancellation(true, "Processing", "COD", 125000)).toEqual({ allowed: true, reason: null, refundCents: 0 });
  });
});

describe("automatic proxy bidding", () => {
  it("retains outbid proxy caps when a later bidder joins the bidding war", () => {
    const ranked = rankCurrentProxyBids([
      bid(1, 101, "active", 10000, 7000, "2026-10-02T10:00:00Z"),
      bid(2, 202, "outbid", 8500, 0, "2026-10-02T10:01:00Z"),
      bid(3, 303, "active", 5000, 0, "2026-10-02T10:02:00Z"),
    ]);
    expect(ranked.map((row) => row.userId)).toEqual([101, 202, 303]);
    expect(calculateProxyWinningBidCents(ranked[0], ranked[1], 7500, 5000, 100)).toBe(8600);
  });

  it("uses the latest cap per user, including when a bidder lowers their cap", () => {
    const ranked = rankCurrentProxyBids([
      bid(1, 101, "outbid", 20000, 0, "2026-10-02T10:00:00Z"),
      bid(2, 202, "active", 15000, 13000, "2026-10-02T10:01:00Z"),
      bid(3, 101, "outbid", 9000, 0, "2026-10-02T10:02:00Z"),
    ]);
    expect(ranked.map((row) => [row.userId, row.maxBidCents])).toEqual([[202, 15000], [101, 9000]]);
  });

  it("automatically raises by the bidder's chosen increment, not the seller floor", () => {
    const leader = bid(1, 101, "active", 100000, 70000, "2026-10-02T10:00:00Z", 1000);
    const runner = bid(2, 202, "outbid", 50000, 0, "2026-10-02T10:01:00Z");
    expect(calculateProxyWinningBidCents(leader, runner, 20000, 5000, 10000)).toBe(51000);
  });

  it("keeps first-to-cap priority when a bidder repeats the same cap", () => {
    const ranked = rankCurrentProxyBids([
      bid(1, 101, "outbid", 60000, 0, "2026-10-02T10:00:00Z"),
      bid(2, 202, "outbid", 60000, 0, "2026-10-02T10:01:00Z"),
      bid(3, 101, "active", 60000, 50000, "2026-10-02T10:02:00Z"),
    ]);
    expect(ranked[0].userId).toBe(101);
  });

  it("resets tie priority when a bidder lowers then later raises their cap again", () => {
    const ranked = rankCurrentProxyBids([
      bid(1, 101, "outbid", 60000, 0, "2026-10-02T10:00:00Z"),
      bid(2, 101, "outbid", 50000, 0, "2026-10-02T10:01:00Z"),
      bid(3, 202, "outbid", 60000, 0, "2026-10-02T10:02:00Z"),
      bid(4, 101, "active", 60000, 50000, "2026-10-02T10:03:00Z"),
    ]);
    expect(ranked[0].userId).toBe(202);
  });

  it("does not carry first-to-cap priority across a cancelled bid", () => {
    const ranked = rankCurrentProxyBids([
      bid(1, 101, "outbid", 60000, 0, "2026-10-02T10:00:00Z"),
      bid(2, 202, "outbid", 60000, 0, "2026-10-02T10:01:00Z"),
      bid(3, 101, "cancelled", 60000, 0, "2026-10-02T10:02:00Z"),
      bid(4, 101, "active", 60000, 50000, "2026-10-02T10:03:00Z"),
    ]);
    expect(ranked[0].userId).toBe(202);
  });
});

describe("live bidder labels", () => {
  it("keeps labels unique beyond ten bidders even when the viewer shares their name", () => {
    const labels = createBidderLabels(Array.from({ length: 12 }, (_, index) => index + 1), 1);
    const others = Array.from({ length: 11 }, (_, index) => labels.get(index + 2));
    expect(labels.get(1)).toBe("You");
    expect(others).toContain("Bidder 10");
    expect(new Set(others).size).toBe(11);
  });
});
