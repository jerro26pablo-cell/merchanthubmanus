import type { Express, Request, Response } from "express";
import { and, desc, eq, lt } from "drizzle-orm";
import { getDb } from "./db";
import { getAppUser } from "./appAuth";
import { commerceOrders, listingsOwned, notifications, proxyBids } from "../drizzle/schema";
import { resolveExpiredAuctionOutcome } from "./auctionState";

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
export async function settleExpiredAuctions() {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  const expired = await db.select().from(listingsOwned).where(and(
    eq(listingsOwned.lifecycle, "official"),
    lt(listingsOwned.auctionEndAt, now),
  ));

  for (const listing of expired) {
    if (listing.listingType !== "Auction" && listing.listingType !== "Both") continue;
    const bids = await db.select().from(proxyBids).where(eq(proxyBids.listingId, listing.listingId)).orderBy(desc(proxyBids.createdAt));
    const outcome = resolveExpiredAuctionOutcome(bids, listing.reserveThresholdCents, listing.stock);
    const winner = outcome.kind === "sold" ? outcome.winner : null;
    const staleNoSale = and(
      eq(notifications.recipientId, listing.ownerId),
      eq(notifications.entityId, listing.listingId),
      eq(notifications.title, "Auction ended without a sale"),
    );

    // Repair legacy alerts in place so sellers see the actual winner and can open the auction.
    const correctedNoSale = winner ? await db.update(notifications).set({
      type: "auction_won",
      title: "Auction ended with a winner",
      message: `“${listing.title}” was won by the highest eligible bidder at ${pesos(winner.currentBidCents)}.`,
    }).where(staleNoSale) : null;

    const settledAt = listing.settledAt ?? now;
    const update = await db.update(listingsOwned).set({
      lifecycle: winner ? "sold" : "auction-ended",
      settledAt,
      stock: winner ? Math.max(0, listing.stock - 1) : listing.stock,
    }).where(and(
      eq(listingsOwned.id, listing.id),
      eq(listingsOwned.lifecycle, "official"),
      lt(listingsOwned.auctionEndAt, now),
    ));
    if (update[0]?.affectedRows === 0) continue;

    const wasAlreadySettled = Boolean(listing.settledAt);
    if (winner) {
      await db.update(proxyBids).set({ status: "won" }).where(eq(proxyBids.id, winner.id));
      await db.update(proxyBids).set({ status: "outbid", currentBidCents: 0 }).where(and(
        eq(proxyBids.listingId, listing.listingId),
        eq(proxyBids.status, "active"),
      ));
      if (!wasAlreadySettled) {
        await createNotification(winner.userId, "auction_won", "Auction won", `You won “${listing.title}” at ${pesos(winner.currentBidCents)}.`, listing.listingId);
      }
      if (!wasAlreadySettled && correctedNoSale?.[0]?.affectedRows === 0) await createNotification(listing.ownerId, "auction_won", "Auction ended with a winner", `“${listing.title}” was won by the highest eligible bidder at ${pesos(winner.currentBidCents)}.`, listing.listingId);
      for (const bidder of bids.filter((bid) => bid.id !== winner.id && bid.status === "active")) {
        await createNotification(bidder.userId, "system", "Auction lost", `The auction for “${listing.title}” ended with a winning bid of ${pesos(winner.currentBidCents)}.`, listing.listingId);
      }
    } else {
      await db.update(proxyBids).set({ status: "outbid", currentBidCents: 0 }).where(and(
        eq(proxyBids.listingId, listing.listingId),
        eq(proxyBids.status, "active"),
      ));
      const existingNoSale = (await db.select({ id: notifications.id }).from(notifications).where(staleNoSale).limit(1))[0];
      if (!existingNoSale) {
        const reason = listing.stock <= 0
          ? "the auction inventory sold out before settlement"
          : !bids.some((bid) => bid.status === "active")
            ? "there were no eligible bids"
            : "the reserve price was not met";
        await createNotification(listing.ownerId, "system", "Auction ended without a sale", `“${listing.title}” ended without a sale because ${reason}. It is now in Inventory → Auction ended, where you can re-auction it or delete it.`, listing.listingId);
      }
      for (const bidder of bids.filter((bid) => bid.status === "active")) {
        await createNotification(bidder.userId, "system", "Auction ended without a sale", `The auction for “${listing.title}” ended without an eligible winner.`, listing.listingId);
      }
    }
  }
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
