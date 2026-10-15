export type CancellationRequestStatus = "pending" | "approved" | "denied";
export type CancellationDecision = Exclude<CancellationRequestStatus, "pending">;

export type CancellationTransition =
  | { requestStatus: CancellationDecision; bidStatus: string }
  | { error: "REQUEST_ALREADY_DECIDED" | "BID_NO_LONGER_ACTIVE" };

export const isListingOwner = (listingOwnerId: number, actorId: number) => listingOwnerId === actorId;

export function resolveCancellationTransition(
  requestStatus: string,
  bidStatus: string | null,
  decision: CancellationDecision,
): CancellationTransition {
  if (requestStatus !== "pending") return { error: "REQUEST_ALREADY_DECIDED" };
  if (decision === "approved" && bidStatus !== "active") return { error: "BID_NO_LONGER_ACTIVE" };
  return {
    requestStatus: decision,
    bidStatus: decision === "approved" ? "cancelled" : bidStatus ?? "missing",
  };
}
