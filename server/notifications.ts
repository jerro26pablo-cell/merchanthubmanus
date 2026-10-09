import type { Express, Request, Response } from "express";
import { and, desc, eq, gte, lte, ne, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { getAppUser } from "./appAuth";
import { commerceOrders, listingsOwned, notifications, proxyBids, users } from "../drizzle/schema";
import { resolveExpiredAuctionOutcome, selectSecondChanceBid } from "./auctionState";
import { publishAuctionUpdate } from "./auctionEvents";
import { calculateAutoAuctionCharge } from "./auctionWallet";

export async function createNotification(recipientId: number, type: "auction_won" | "delivery_update" | "order_created" | "system", title: string, message: string, entityId?: string) {
  const db = await getDb();
  if (!db) return;
  await db.insert(notifications).values({ recipientId, type, title, message, entityId: entityId ?? null });
}

const pesos = (cents: number) => `₱${(cents / 100).toLocaleString("en-PH")}`;

/**
 * Finalize ended official auctions exactly once. A listing's lifecycle transition
 * is the claim, so parallel notification/listing refreshes cannot settle it twice.
 */
async function expireAcceptanceWindows(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, now: Date) {
  const soldListings = await db.select().from(listingsOwned).where(or(eq(listingsOwned.lifecycle, "sold"), eq(listingsOwned.lifecycle, "canceled")));
  for (const listing of soldListings) {
    const expiring = (await db.select().from(proxyBids).where(and(eq(proxyBids.listingId, listing.listingId), or(eq(proxyBids.status, "won"), eq(proxyBids.status, "offered")), lte(proxyBids.acceptanceDeadline, now))).limit(1))[0];
    if (!expiring) continue;
    let runner: any = null;
    const expired = await db.transaction(async (tx) => {
      const claimed = await tx.update(listingsOwned).set({ lifecycle: "canceled", stock: expiring.status === "won" ? listing.stock + 1 : listing.stock }).where(and(eq(listingsOwned.listingId, listing.listingId), or(eq(listingsOwned.lifecycle, "sold"), eq(listingsOwned.lifecycle, "canceled"))));
      if (claimed[0]?.affectedRows === 0) return false;
      const won = await tx.update(proxyBids).set({ status: "cancelled", currentBidCents: 0, reservedCents: 0, acceptanceDeadline: null }).where(and(eq(proxyBids.id, expiring.id), eq(proxyBids.status, expiring.status)));
      if (won[0]?.affectedRows === 0) return false;
      const order = expiring.status === "won" ? (await tx.select().from(commerceOrders).where(eq(commerceOrders.auctionBidId, expiring.id)).limit(1))[0] : undefined;
      if (order && order.status === "Processing") {
        await tx.update(commerceOrders).set({ status: "Cancelled" }).where(eq(commerceOrders.id, order.id));
        if (order.payment === "E-wallet" && order.amountCents > 0) await tx.update(users).set({ walletCents: sql`${users.walletCents} + ${order.amountCents}` }).where(eq(users.id, expiring.userId));
      }
      const rows = await tx.select().from(proxyBids).where(eq(proxyBids.listingId, listing.listingId)).orderBy(desc(proxyBids.createdAt));
      runner = expiring.status === "won" ? selectSecondChanceBid(rows, expiring.userId) : null;
      if (runner) {
        const offered = await tx.update(proxyBids).set({ status: "offered", currentBidCents: runner.maxBidCents, reservedCents: 0, acceptanceDeadline: new Date(now.getTime() + 24 * 60 * 60 * 1000) }).where(and(eq(proxyBids.id, runner.id), eq(proxyBids.status, "outbid")));
        if (offered[0]?.affectedRows === 0) runner = null;
      }
      return true;
    });
    if (!expired) continue;
    await createNotification(expiring.userId, "system", expiring.status === "won" ? "Winner acceptance expired" : "Second-chance offer expired", expiring.status === "won" ? `Your 24-hour acceptance window for “${listing.title}” expired. The item is being offered to the next eligible bidder.` : `Your 24-hour second-chance window for “${listing.title}” expired. The item is now in the seller’s Canceled inventory.`, listing.listingId);
    if (runner) {
      await createNotification(runner.userId, "system", "Second-chance offer", `The first winner did not accept “${listing.title}” within 24 hours. You have 24 hours to accept this offer at ${pesos(runner.maxBidCents)}.`, listing.listingId);
      await createNotification(listing.ownerId, "system", "Winner acceptance expired", `The first winner did not accept “${listing.title}”. A 24-hour second-chance offer is now active.`, listing.listingId);
    } else {
      await createNotification(listing.ownerId, "system", "Auction canceled", `No eligible bidder accepted “${listing.title}” within the required window. It is now in Inventory → Canceled.`, listing.listingId);
    }
    publishAuctionUpdate(listing.listingId);
  }
}

export async function settleExpiredAuctions() {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  await expireAcceptanceWindows(db, now);
  const expired = await db.select().from(listingsOwned).where(and(
    eq(listingsOwned.lifecycle, "official"),
    lte(listingsOwned.auctionEndAt, now),
  ));

  for (const listing of expired) {
    if (listing.listingType !== "Auction" && listing.listingType !== "Both") continue;
    const bids = await db.select().from(proxyBids).where(eq(proxyBids.listingId, listing.listingId)).orderBy(desc(proxyBids.createdAt));
    const outcome = resolveExpiredAuctionOutcome(bids, listing.reserveThresholdCents, listing.stock);
    const candidateWinner = outcome.kind === "sold" ? outcome.winner : null;
    const winnerRow = candidateWinner ? bids.find((bid) => bid.id === candidateWinner.id) ?? null : null;
    const autoCheckout = Boolean(candidateWinner && listing.winnerCancellationAllowed === 0);
    const amountCents = candidateWinner?.currentBidCents ?? 0;
    const staleNoSale = and(
      eq(notifications.recipientId, listing.ownerId),
      eq(notifications.entityId, listing.listingId),
      eq(notifications.title, "Auction ended without a sale"),
    );
    const wasAlreadySettled = Boolean(listing.settledAt);

    let automaticOrderId: string | null = null;
    let automaticCheckoutFailed = false;
    const settled = await db.transaction(async (tx) => {
      const claimed = await tx.update(listingsOwned).set({
        lifecycle: candidateWinner ? "sold" : "auction-ended",
        settledAt: listing.settledAt ?? now,
        stock: candidateWinner ? Math.max(0, listing.stock - 1) : listing.stock,
      }).where(and(eq(listingsOwned.id, listing.id), eq(listingsOwned.lifecycle, "official"), lte(listingsOwned.auctionEndAt, now)));
      if (claimed[0]?.affectedRows === 0) return false;

      if (candidateWinner && autoCheckout) {
        const orderAlreadyExists = (await tx.select({ orderId: commerceOrders.orderId }).from(commerceOrders).where(eq(commerceOrders.auctionBidId, candidateWinner.id)).limit(1))[0];
        if (orderAlreadyExists) {
          automaticOrderId = orderAlreadyExists.orderId;
        } else {
          const holds = await tx.select({ listingId: proxyBids.listingId, reservedCents: proxyBids.reservedCents }).from(proxyBids).where(eq(proxyBids.userId, candidateWinner.userId));
          const heldElsewhere = holds.filter((row) => row.listingId !== listing.listingId).reduce((sum, row) => sum + Math.max(0, row.reservedCents ?? 0), 0);
          const requiredDetails = Boolean(winnerRow!.shippingPhone && winnerRow!.shippingProvince && winnerRow!.shippingMunicipality && winnerRow!.shippingAddressDetails && winnerRow!.shippingLatitude != null && winnerRow!.shippingLongitude != null);
          let chargeableAmount = 0;
          try { chargeableAmount = calculateAutoAuctionCharge(winnerRow!.reservedCents, amountCents).chargedCents; } catch { chargeableAmount = 0; }
          const chargeable = chargeableAmount > 0 && chargeableAmount <= candidateWinner.maxBidCents && requiredDetails;
          const debited = chargeable ? await tx.update(users).set({ walletCents: sql`${users.walletCents} - ${chargeableAmount}` }).where(and(eq(users.id, candidateWinner.userId), gte(users.walletCents, chargeableAmount + heldElsewhere))) : null;
          if (!chargeable || debited?.[0]?.affectedRows === 0) {
            automaticCheckoutFailed = true;
            await tx.update(listingsOwned).set({ lifecycle: "auction-ended", stock: listing.stock, settledAt: listing.settledAt ?? now }).where(eq(listingsOwned.id, listing.id));
            await tx.update(proxyBids).set({ status: "outbid", currentBidCents: 0, reservedCents: 0 }).where(and(eq(proxyBids.listingId, listing.listingId), eq(proxyBids.status, "active")));
            await tx.update(proxyBids).set({ reservedCents: 0 }).where(eq(proxyBids.listingId, listing.listingId));
            await tx.update(proxyBids).set({ shippingPhone: null, shippingProvince: null, shippingMunicipality: null, shippingAddressDetails: null, shippingLatitude: null, shippingLongitude: null }).where(eq(proxyBids.listingId, listing.listingId));
            return true;
          }
          automaticOrderId = `MH-AUC-${candidateWinner.id}-${Date.now()}`;
          await tx.insert(commerceOrders).values({
            orderId: automaticOrderId,
            listingId: listing.listingId,
            auctionBidId: candidateWinner.id,
            buyerId: candidateWinner.userId,
            sellerId: listing.ownerId,
            quantity: 1,
            amountCents,
            payment: "E-wallet",
            province: winnerRow!.shippingProvince!,
            municipality: winnerRow!.shippingMunicipality!,
            addressDetails: winnerRow!.shippingAddressDetails,
            contactNumber: winnerRow!.shippingPhone,
            destinationLatitude: winnerRow!.shippingLatitude,
            destinationLongitude: winnerRow!.shippingLongitude,
            status: "Processing",
          });
        }
      }

      if (candidateWinner && !automaticCheckoutFailed) {
        await tx.update(proxyBids).set({ status: "won", reservedCents: 0, acceptanceDeadline: autoCheckout ? null : new Date(now.getTime() + 24 * 60 * 60 * 1000) }).where(eq(proxyBids.id, candidateWinner.id));
        await tx.update(proxyBids).set({ status: "outbid", currentBidCents: 0, reservedCents: 0, acceptanceDeadline: null }).where(and(eq(proxyBids.listingId, listing.listingId), eq(proxyBids.status, "active"), ne(proxyBids.id, candidateWinner.id)));
        await tx.update(proxyBids).set({ reservedCents: 0 }).where(eq(proxyBids.listingId, listing.listingId));
      } else if (!candidateWinner) {
        await tx.update(proxyBids).set({ status: "outbid", currentBidCents: 0, reservedCents: 0 }).where(and(eq(proxyBids.listingId, listing.listingId), eq(proxyBids.status, "active")));
        await tx.update(proxyBids).set({ reservedCents: 0 }).where(eq(proxyBids.listingId, listing.listingId));
      }
      await tx.update(proxyBids).set({ shippingPhone: null, shippingProvince: null, shippingMunicipality: null, shippingAddressDetails: null, shippingLatitude: null, shippingLongitude: null }).where(eq(proxyBids.listingId, listing.listingId));
      return true;
    });
    if (!settled) continue;

    if (candidateWinner && !automaticCheckoutFailed) {
      const corrected = await db.update(notifications).set({
        type: "auction_won",
        title: "Auction ended with a winner",
        message: `“${listing.title}” was won by the highest eligible bidder at ${pesos(candidateWinner.currentBidCents)}.`,
      }).where(staleNoSale);
      if (!wasAlreadySettled) {
        if (autoCheckout && automaticOrderId) {
          await createNotification(candidateWinner.userId, "order_created", "Auction won — order created automatically", `You won “${listing.title}” at ${pesos(amountCents)}. Your no-cancellation auction order ${automaticOrderId} was automatically paid from your reserved demo-wallet funds.`, automaticOrderId);
          await createNotification(listing.ownerId, "order_created", "Auction order ready for fulfillment", `The winning buyer automatically checked out “${listing.title}” at ${pesos(amountCents)}. Order ${automaticOrderId} is ready for fulfillment.`, automaticOrderId);
        } else {
          await createNotification(candidateWinner.userId, "auction_won", "You are the winner of this item", `You won “${listing.title}” at ${pesos(candidateWinner.currentBidCents)}. Complete checkout from your auction record to confirm delivery and payment.`, listing.listingId);
        }
      }
      if (!wasAlreadySettled && corrected[0]?.affectedRows === 0) await createNotification(listing.ownerId, "auction_won", "Auction ended with a winner", `“${listing.title}” was won by the highest eligible bidder at ${pesos(candidateWinner.currentBidCents)}.`, listing.listingId);
      for (const bidder of bids.filter((bid) => bid.id !== candidateWinner.id && bid.status === "active")) {
        await createNotification(bidder.userId, "system", "Auction lost", `The auction for “${listing.title}” ended with a winning bid of ${pesos(candidateWinner.currentBidCents)}. Any reserved demo-wallet funds are available again.`, listing.listingId);
      }
    } else {
      const existingNoSale = (await db.select({ id: notifications.id }).from(notifications).where(staleNoSale).limit(1))[0];
      if (automaticCheckoutFailed) {
        await createNotification(candidateWinner!.userId, "system", "Automatic checkout could not complete", `“${listing.title}” could not be auto-checked out because the reserved wallet or delivery details were incomplete. The auction ended without a sale; any demo-wallet hold was released.`, listing.listingId);
        await createNotification(listing.ownerId, "system", "Auction ended without a sale", `“${listing.title}” could not be automatically checked out. It is in Inventory → Auction ended and can be re-auctioned or deleted.`, listing.listingId);
      } else if (!existingNoSale) {
        const reason = listing.stock <= 0
          ? "the auction inventory sold out before settlement"
          : !bids.some((bid) => bid.status === "active")
            ? "there were no eligible bids"
            : "the reserve price was not met";
        await createNotification(listing.ownerId, "system", "Auction ended without a sale", `“${listing.title}” ended without a sale because ${reason}. It is now in Inventory → Auction ended, where you can re-auction it or delete it.`, listing.listingId);
      }
      for (const bidder of bids.filter((bid) => bid.status === "active")) {
        await createNotification(bidder.userId, "system", "Auction ended without a sale", `The auction for “${listing.title}” ended without an eligible winner. Any reserved demo-wallet funds are available again.`, listing.listingId);
      }
    }
    publishAuctionUpdate(listing.listingId);
  }
}
let auctionSettlementTimer: ReturnType<typeof setTimeout> | undefined;
export function startAuctionSettlementLoop(intervalMs = 2500) {
  if (auctionSettlementTimer) return;
  const run = async () => {
    try { await settleExpiredAuctions(); }
    catch (error) { console.error("[Auctions] Background settlement check failed", error); }
    auctionSettlementTimer = setTimeout(run, intervalMs);
    auctionSettlementTimer.unref?.();
  };
  void run();
}

export const registerNotificationRoutes = (app: Express) => {
  app.get("/api/notifications", async (req, res) => {
    const user = await getAppUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "Please log in." });
    const db = await getDb();
    if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    await settleExpiredAuctions();
    const rows = await db.select().from(notifications).where(eq(notifications.recipientId, user.id)).orderBy(desc(notifications.createdAt)).limit(50);
    return res.json({ ok: true, notifications: rows });
  });
  app.post("/api/notifications/:id/read", async (req, res) => {
    const user = await getAppUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "Please log in." });
    const db = await getDb();
    if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, Number(req.params.id)), eq(notifications.recipientId, user.id)));
    return res.json({ ok: true });
  });
};
