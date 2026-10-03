import { describe, expect, it } from "vitest";
import { calculateAuctionHoldChange, calculateAutoAuctionCharge, getSpendableWalletCents } from "./auctionWallet";

describe("auction wallet holds", () => {
  it("subtracts active reservations from the spendable balance", () => {
    expect(getSpendableWalletCents(100_000, 35_000)).toBe(65_000);
    expect(getSpendableWalletCents(10_000, 12_000)).toBe(0);
  });

  it("reserves a new maximum cap for no-change-of-mind auctions", () => {
    expect(calculateAuctionHoldChange(20_000, 35_000, false)).toEqual({ previousHoldCents: 20_000, nextHoldCents: 35_000, deltaCents: 15_000 });
  });

  it("does not hold funds for cancellation-permitted auctions", () => {
    expect(calculateAuctionHoldChange(20_000, 35_000, true)).toEqual({ previousHoldCents: 20_000, nextHoldCents: 0, deltaCents: -20_000 });
  });

  it("charges the winning price and releases the unused part of the reserved cap", () => {
    expect(calculateAutoAuctionCharge(60_000, 42_500)).toEqual({ chargedCents: 42_500, releasedCents: 17_500 });
  });

  it("rejects a winning price above the reservation", () => {
    expect(() => calculateAutoAuctionCharge(30_000, 30_100)).toThrow("Winning price exceeds the reserved maximum bid.");
  });
});
