import { describe, expect, it, vi } from "vitest";
import { publishAuctionUpdate, subscribeAuctionUpdates } from "./auctionEvents";

describe("auction update subscriptions", () => {
  it("publishes only to listeners for the changed listing", () => {
    const changed = vi.fn();
    const other = vi.fn();
    const unsubscribe = subscribeAuctionUpdates("listing-a", changed);
    subscribeAuctionUpdates("listing-b", other);

    publishAuctionUpdate("listing-a");

    expect(changed).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    unsubscribe();
    publishAuctionUpdate("listing-a");
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
