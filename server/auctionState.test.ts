import { describe, expect, it } from "vitest";
import { resolveExpiredAuctionOutcome, selectAuctionSummaryBid, selectSecondChanceBid, secondChanceTransition, type AuctionBidState } from "./auctionState";

const bid = (id: number, userId: number, status: AuctionBidState["status"], maxBidCents: number, currentBidCents: number, createdAt: string): AuctionBidState => ({ id, userId, status, maxBidCents, currentBidCents, createdAt });

const saleBids = [
  bid(1, 101, "won", 18000, 15000, "2026-10-01T10:00:00Z"),
  bid(2, 202, "outbid", 14000, 0, "2026-10-01T10:01:00Z"),
  bid(3, 303, "outbid", 12000, 0, "2026-10-01T10:02:00Z"),
];

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
    expect(secondChanceTransition("decline")).toEqual({ bidStatus: "cancelled", listingLifecycle: "auction-ended" });
  });
});
