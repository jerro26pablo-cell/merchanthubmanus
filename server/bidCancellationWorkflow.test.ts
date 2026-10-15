import { describe, expect, it } from "vitest";
import { isListingOwner, resolveCancellationTransition } from "./bidCancellationWorkflow";

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
});
