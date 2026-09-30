import type { Express, Request, Response } from "express";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { getDb } from "./db";
import { getAppUser } from "./appAuth";
import { commerceOrders, listingsOwned, notifications, proxyBids } from "../drizzle/schema";

export async function createNotification(recipientId: number, type: "auction_won" | "delivery_update" | "order_created" | "system", title: string, message: string, entityId?: string) {
  const db = await getDb(); if (!db) return;
  await db.insert(notifications).values({ recipientId, type, title, message, entityId: entityId ?? null });
}

export async function settleExpiredAuctions() {
  const db = await getDb(); if (!db) return;
  const expired = await db.select().from(listingsOwned).where(and(eq(listingsOwned.lifecycle, "official"), lt(listingsOwned.auctionEndAt, new Date()), isNull(listingsOwned.settledAt)));
  for (const listing of expired) {
    const bids = await db.select().from(proxyBids).where(and(eq(proxyBids.listingId, listing.listingId), eq(proxyBids.status, "active"))).orderBy(desc(proxyBids.currentBidCents));
    const winner = bids[0];
    const reserveMet = !listing.reserveThresholdCents || Boolean(winner && winner.currentBidCents >= listing.reserveThresholdCents);
    if (winner && reserveMet) {
      await createNotification(winner.userId, "auction_won", "Auction won", `You won “${listing.title}” at ₱${(winner.currentBidCents / 100).toLocaleString("en-PH")}.`, listing.listingId);
      await createNotification(listing.ownerId, "auction_won", "Auction ended with a winner", `“${listing.title}” was won at ₱${(winner.currentBidCents / 100).toLocaleString("en-PH")}.`, listing.listingId);
      await db.update(proxyBids).set({ status: "won" }).where(eq(proxyBids.id, winner.id));
    } else {
      await createNotification(listing.ownerId, "system", "Auction ended without a sale", `“${listing.title}” ended without meeting its reserve threshold.`, listing.listingId);
    }
    await db.update(listingsOwned).set({ settledAt: new Date() }).where(eq(listingsOwned.id, listing.id));
  }
}

export const registerNotificationRoutes = (app: Express) => {
  app.get("/api/notifications", async (req, res) => {
    const user = await getAppUser(req); if (!user) return res.status(401).json({ ok: false, error: "Please log in." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    await settleExpiredAuctions();
    const rows = await db.select().from(notifications).where(eq(notifications.recipientId, user.id)).orderBy(desc(notifications.createdAt)).limit(50);
    return res.json({ ok: true, notifications: rows });
  });
  app.post("/api/notifications/:id/read", async (req, res) => {
    const user = await getAppUser(req); if (!user) return res.status(401).json({ ok: false, error: "Please log in." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, Number(req.params.id)), eq(notifications.recipientId, user.id)));
    return res.json({ ok: true });
  });
};
