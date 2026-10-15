import { describe, expect, it } from "vitest";
import { isListingOwner, resolveCancellationTransition, resolveDemoWalletRefundCents } from "./bidCancellationWorkflow";

describe("seller-approved bid cancellation", () => {
  it("allows only the listing owner to decide the request", () => {
    expect(isListingOwner(14, 14)).toBe(true);
    expect(isListingOwner(14, 22)).toBe(false);
  });

  it("keeps a pending request and active bid unchanged until a decision", () => {
    expect(resolveCancellationTransition("pending", "active", "denied")).toEqual({
      requestStatus: "denied",
      bidStatus: "active",
    });
  });

  it("cancels the active bid only when the seller approves", () => {
    expect(resolveCancellationTransition("pending", "active", "approved")).toEqual({
      requestStatus: "approved",
      bidStatus: "cancelled",
    });
  });

  it("keeps a won auction bid unchanged when the seller denies the request", () => {
    expect(resolveCancellationTransition("pending", "won", "denied")).toEqual({
      requestStatus: "denied",
      bidStatus: "won",
    });
  });

  it("cancels a won auction bid only after seller approval", () => {
    expect(resolveCancellationTransition("pending", "won", "approved")).toEqual({
      requestStatus: "approved",
      bidStatus: "cancelled",
    });
  });

  it("does not approve a bid that is no longer active", () => {
    expect(resolveCancellationTransition("pending", "outbid", "approved")).toEqual({
      error: "BID_NO_LONGER_ACTIVE",
    });
  });

  it("does not allow an already-decided request to be changed again", () => {
    expect(resolveCancellationTransition("approved", "cancelled", "denied")).toEqual({
      error: "REQUEST_ALREADY_DECIDED",
    });
  });

  it("refunds only a matching paid PHP demo-wallet ledger entry", () => {
    expect(resolveDemoWalletRefundCents("E-wallet", "demo_wallet", "paid", 125000, "PHP")).toBe(125000);
    expect(resolveDemoWalletRefundCents("E-wallet", "demo_wallet", "processing", 125000, "PHP")).toBe(125000);
  });

  it("does not refund COD, Stripe, unpaid, mismatched, cancelled, or invalid ledger entries", () => {
    expect(resolveDemoWalletRefundCents("COD", "cod", "pending", 125000, "PHP")).toBe(0);
    expect(resolveDemoWalletRefundCents("E-wallet", "stripe", "paid", 125000, "PHP")).toBe(0);
    expect(resolveDemoWalletRefundCents("E-wallet", "demo_wallet", "pending", 125000, "PHP")).toBe(0);
    expect(resolveDemoWalletRefundCents("E-wallet", "demo_wallet", "cancelled", 125000, "PHP")).toBe(0);
    expect(resolveDemoWalletRefundCents("COD", "demo_wallet", "paid", 125000, "PHP")).toBe(0);
    expect(resolveDemoWalletRefundCents("E-wallet", "demo_wallet", "paid", 125000, "USD")).toBe(0);
    expect(resolveDemoWalletRefundCents("E-wallet", "demo_wallet", "paid", -1, "PHP")).toBe(0);
  });
});
