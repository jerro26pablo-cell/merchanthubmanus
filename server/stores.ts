import type { Express, Request, Response } from "express";
import { and, count, eq } from "drizzle-orm";
import { getDb } from "./db";
import { getAppUser } from "./appAuth";
import { listingsOwned, notifications, storeFollows, users } from "../drizzle/schema";
import { createNotification } from "./notifications";

const auth = async (req: Request, res: Response) => {
  const user = await getAppUser(req);
  if (!user) { res.status(401).json({ ok: false, error: "Please log in." }); return undefined; }
  return user;
};

async function getStore(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, sellerId: number) {
  const seller = (await db.select({ id: users.id, name: users.name, storeName: users.storeName, storeImage: users.storeImage, province: users.province, municipality: users.municipality, sellerEnabled: users.sellerEnabled }).from(users).where(eq(users.id, sellerId)).limit(1))[0];
  if (!seller) return null;
  const hasOfficialListings = Boolean((await db.select({ id: listingsOwned.id }).from(listingsOwned).where(and(eq(listingsOwned.ownerId, sellerId), eq(listingsOwned.lifecycle, "official"))).limit(1))[0]);
  if (!seller.sellerEnabled && !hasOfficialListings) return null;
  return seller;
}

async function followerCount(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, sellerId: number) {
  const result = await db.select({ total: count() }).from(storeFollows).where(eq(storeFollows.sellerId, sellerId));
  return Number(result[0]?.total ?? 0);
}

export async function notifyFollowedStoreUpcomingAuction(listing: typeof listingsOwned.$inferSelect) {
  if (listing.lifecycle !== "official" || listing.stock <= 0 || (listing.listingType !== "Auction" && listing.listingType !== "Both") || !listing.auctionStartAt || listing.auctionStartAt.getTime() <= Date.now() || (listing.auctionEndAt && listing.auctionEndAt.getTime() <= listing.auctionStartAt.getTime())) return;
  const db = await getDb(); if (!db) return;
  const store = await getStore(db, listing.ownerId); if (!store) return;
  const followers = await db.select({ followerId: storeFollows.followerId }).from(storeFollows).where(eq(storeFollows.sellerId, listing.ownerId));
  const start = listing.auctionStartAt.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
  const storeName = store.storeName || store.name || "A store you follow";
  const title = "Upcoming auction from a store you follow";
  for (const { followerId } of followers) {
    if (followerId === listing.ownerId) continue;
    const alreadyNotified = Boolean((await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.recipientId, followerId), eq(notifications.entityId, listing.listingId), eq(notifications.title, title))).limit(1))[0]);
    if (alreadyNotified) continue;
    await createNotification(followerId, "system", title, `${storeName} scheduled “${listing.title}”. Bidding opens ${start} Philippine time. Open the item to review the auction.`, listing.listingId);
  }
}

export function registerStoreRoutes(app: Express) {
  app.get("/api/stores/following", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const rows = await db.select({ sellerId: storeFollows.sellerId }).from(storeFollows).where(eq(storeFollows.followerId, user.id));
    return res.json({ ok: true, sellerIds: rows.map((row) => row.sellerId) });
  });

  app.get("/api/stores/:sellerId", async (req, res) => {
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const sellerId = Number(req.params.sellerId);
    if (!Number.isSafeInteger(sellerId) || sellerId <= 0) return res.status(400).json({ ok: false, error: "Store not found." });
    const seller = await getStore(db, sellerId);
    if (!seller) return res.status(404).json({ ok: false, error: "Store not found." });
    const viewer = await getAppUser(req);
    const following = Boolean(viewer && (await db.select({ id: storeFollows.id }).from(storeFollows).where(and(eq(storeFollows.followerId, viewer.id), eq(storeFollows.sellerId, sellerId))).limit(1))[0]);
    return res.json({ ok: true, store: { id: seller.id, name: seller.storeName || seller.name || "MerchantHub store", image: seller.storeImage, province: seller.province, municipality: seller.municipality, followerCount: await followerCount(db, sellerId), following } });
  });

  app.post("/api/stores/:sellerId/follow", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const sellerId = Number(req.params.sellerId);
    if (!Number.isSafeInteger(sellerId) || sellerId <= 0 || sellerId === user.id) return res.status(400).json({ ok: false, error: "Choose another valid store to follow." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    if (!await getStore(db, sellerId)) return res.status(404).json({ ok: false, error: "Store not found." });
    await db.insert(storeFollows).values({ followerId: user.id, sellerId }).onDuplicateKeyUpdate({ set: { sellerId } });
    return res.json({ ok: true, following: true, followerCount: await followerCount(db, sellerId) });
  });

  app.delete("/api/stores/:sellerId/follow", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const sellerId = Number(req.params.sellerId);
    if (!Number.isSafeInteger(sellerId) || sellerId <= 0) return res.status(400).json({ ok: false, error: "Choose a valid store." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    await db.delete(storeFollows).where(and(eq(storeFollows.followerId, user.id), eq(storeFollows.sellerId, sellerId)));
    return res.json({ ok: true, following: false, followerCount: await followerCount(db, sellerId) });
  });
}
