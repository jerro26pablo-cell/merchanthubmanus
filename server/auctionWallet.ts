export type AuctionHoldChange = { previousHoldCents: number; nextHoldCents: number; deltaCents: number };

export function getSpendableWalletCents(walletCents: number, reservedCents: number): number {
  const balance = Number.isFinite(walletCents) ? Math.max(0, Math.floor(walletCents)) : 0;
  const reserved = Number.isFinite(reservedCents) ? Math.max(0, Math.floor(reservedCents)) : 0;
  return Math.max(0, balance - reserved);
}

export function calculateAuctionHoldChange(previousHoldCents: number, newMaxBidCents: number, cancellationAllowed: boolean): AuctionHoldChange {
  const previous = Math.max(0, Math.floor(previousHoldCents));
  const next = cancellationAllowed ? 0 : Math.max(0, Math.floor(newMaxBidCents));
  return { previousHoldCents: previous, nextHoldCents: next, deltaCents: next - previous };
}

export function calculateAutoAuctionCharge(reservedCents: number, winningPriceCents: number): { chargedCents: number; releasedCents: number } {
  const reserved = Math.max(0, Math.floor(reservedCents));
  const winningPrice = Math.max(0, Math.floor(winningPriceCents));
  if (winningPrice <= 0 || winningPrice > reserved) throw new Error("Winning price exceeds the reserved maximum bid.");
  return { chargedCents: winningPrice, releasedCents: reserved - winningPrice };
}
