export type CancellationRequestStatus = "pending" | "approved" | "denied";
export type CancellationDecision = Exclude<CancellationRequestStatus, "pending">;

export type CancellationTransition =
  | { requestStatus: CancellationDecision; bidStatus: string }
  | { error: "REQUEST_ALREADY_DECIDED" | "BID_NO_LONGER_ACTIVE" };

export const isListingOwner = (listingOwnerId: number, actorId: number) => listingOwnerId === actorId;

export function resolveDemoWalletRefundCents(
  orderPayment: string | null | undefined,
  paymentMethod: string | null | undefined,
  paymentStatus: string | null | undefined,
  amountMinor: number | null | undefined,
  currency: string | null | undefined,
): number {
  if (orderPayment !== "E-wallet" || paymentMethod !== "demo_wallet" || currency !== "PHP") return 0;
  if (paymentStatus !== "paid" && paymentStatus !== "processing") return 0;
  return Number.isSafeInteger(amountMinor) && amountMinor! > 0 ? amountMinor! : 0;
}

export function resolveCancellationTransition(
  requestStatus: string,
  bidStatus: string | null,
  decision: CancellationDecision,
): CancellationTransition {
  if (requestStatus !== "pending") return { error: "REQUEST_ALREADY_DECIDED" };
  if (decision === "approved" && bidStatus !== "active" && bidStatus !== "won") return { error: "BID_NO_LONGER_ACTIVE" };
  return {
    requestStatus: decision,
    bidStatus: decision === "approved" ? "cancelled" : bidStatus ?? "missing",
  };
}
