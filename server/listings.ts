import type { Express, Request, Response } from "express";
import { and, eq, ne, or } from "drizzle-orm";
import { getDb } from "./db";
import { getAppUser } from "./appAuth";
import { commerceOrders, listingsOwned, proxyBids, users, wishlists } from "../drizzle/schema";
import { createNotification, settleExpiredAuctions } from "./notifications";
import { notifySavedSearchMatches } from "./savedSearches";
import { publishAuctionUpdate } from "./auctionEvents";

const requireUser = async (req: Request, res: Response) => {
  const user = await getAppUser(req);
  if (!user) { res.status(401).json({ ok: false, error: "Please log in." }); return undefined; }
  return user;
};
const toListing = (row: typeof listingsOwned.$inferSelect, seller = "") => {
  let photos: string[] = [];
  if (row.imageData) { try { const parsed = JSON.parse(row.imageData); photos = Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [row.imageData]; } catch { photos = [row.imageData]; } }
  return { id: row.listingId, title: row.title, description: row.description, category: row.category, subcategory: row.subcategory ?? undefined, type: row.listingType, price: row.priceCents / 100, startingBid: row.listingType === "Auction" || row.listingType === "Both" ? row.priceCents / 100 : undefined, buyNow: row.listingType === "Buy now" ? row.priceCents / 100 : row.listingType === "Both" ? (row.buyNowPriceCents ?? row.priceCents) / 100 : undefined, stock: row.stock, condition: row.condition, image: photos[0] || "", photos, seller, sellerRating: 5, accent: "coral", auctionStartAt: row.auctionStartAt?.toISOString(), auctionEndAt: row.auctionEndAt?.toISOString(), reserveThreshold: row.reserveThresholdCents == null ? undefined : row.reserveThresholdCents / 100, minimumIncrement: row.minimumIncrementCents == null ? undefined : row.minimumIncrementCents / 100, antiSnipeSeconds: row.antiSnipeSeconds ?? 120, winnerCancellationAllowed: Boolean(row.winnerCancellationAllowed), lifecycle: row.lifecycle, settledAt: row.settledAt?.toISOString(), ownerId: row.ownerId };
};
export const registerListingRoutes = (app: Express) => {
  app.get("/api/metrics/overview", async (req, res) => {
    const user = await getAppUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "Please log in." });
    const db = await getDb();
    if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    await settleExpiredAuctions();
    const ownerFilter = user.role === "admin" ? undefined : user.id;
    const listingRows = await db.select({ id: listingsOwned.listingId, stock: listingsOwned.stock, type: listingsOwned.listingType, start: listingsOwned.auctionStartAt, end: listingsOwned.auctionEndAt }).from(listingsOwned).where(ownerFilter ? and(eq(listingsOwned.ownerId, ownerFilter), eq(listingsOwned.lifecycle, "official")) : eq(listingsOwned.lifecycle, "official"));
    const orderRows = user.role === "admin" ? await db.select().from(commerceOrders) : await db.select().from(commerceOrders).where(or(eq(commerceOrders.buyerId, user.id), eq(commerceOrders.sellerId, user.id)));
    const liveAuctions = listingRows.filter((row) => row.stock > 0 && (row.type === "Auction" || row.type === "Both") && (!row.start || row.start.getTime() <= Date.now()) && (!row.end || row.end.getTime() > Date.now())).length;
    const transitStatuses = new Set(["Processing", "Rider assigned", "Picked up", "In transit"]);
    const inTransit = orderRows.filter((row) => transitStatuses.has(row.status)).length;
    const grossSalesCents = orderRows.filter((row) => row.status !== "Cancelled" && (user.role === "admin" || row.sellerId === user.id)).reduce((sum, row) => sum + row.amountCents, 0);
    const availableStock = listingRows.reduce((sum, row) => sum + row.stock, 0);
    const recentSalesCents = orderRows.filter((row) => row.status !== "Cancelled" && row.sellerId === user.id).reduce((sum, row) => sum + row.amountCents, 0);
    const forecastDays = 30;
    const averageDailySalesCents = recentSalesCents / Math.max(1, 30);
    return res.json({ ok: true, metrics: { grossSalesCents, liveAuctions, ordersInTransit: inTransit, availableStock, skuCount: listingRows.length, averageDailySalesCents, forecastDays, projectedDemandCents: averageDailySalesCents * forecastDays, stockCoverageDays: averageDailySalesCents > 0 ? Math.round((availableStock * 100) / averageDailySalesCents) : null } });
  });
  app.get("/api/listings", async (req, res) => {
    const user = await getAppUser(req);
    const db = await getDb();
    if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    await settleExpiredAuctions();
    const ownerOnly = req.query.owner === "me";
    if (ownerOnly && !user) return res.status(401).json({ ok: false, error: "Please log in." });
    let ownerRows = ownerOnly && user ? await db.select().from(listingsOwned).where(eq(listingsOwned.ownerId, user.id)) : await db.select().from(listingsOwned).where(eq(listingsOwned.lifecycle, "official"));
    if (ownerOnly && user) {
      for (const row of ownerRows.filter((item) => item.lifecycle === "official" && item.stock <= 0)) {
        const activeBid = (await db.select({ id: proxyBids.id }).from(proxyBids).where(and(eq(proxyBids.listingId, row.listingId), eq(proxyBids.status, "active"))).limit(1))[0];
        if (!activeBid) await db.update(listingsOwned).set({ lifecycle: "draft" }).where(and(eq(listingsOwned.listingId, row.listingId), eq(listingsOwned.lifecycle, "official")));
      }
      ownerRows = await db.select().from(listingsOwned).where(eq(listingsOwned.ownerId, user.id));
    }
    const rows = ownerOnly ? ownerRows : ownerRows.filter((row) => row.stock > 0 && (!(row.listingType === "Auction" || row.listingType === "Both") || !row.auctionEndAt || row.auctionEndAt.getTime() > Date.now()));
    const owners = await db.select({ id: users.id, name: users.name, storeName: users.storeName }).from(users);
    const ownerMap = new Map(owners.map((owner) => [owner.id, owner.storeName || owner.name || "MerchantHub seller"]));
    const pendingOffers = new Set((await db.select({ listingId: proxyBids.listingId }).from(proxyBids).where(eq(proxyBids.status, "offered"))).map((row) => row.listingId));
    return res.json({ ok: true, listings: rows.map((row) => ({ ...toListing(row, ownerMap.get(row.ownerId) || "MerchantHub seller"), secondChancePending: pendingOffers.has(row.listingId) })) });
  });
  app.get("/api/listings/:listingId", async (req, res) => {
    const user = await getAppUser(req);
    const db = await getDb();
    if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    await settleExpiredAuctions();
    const row = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, req.params.listingId)).limit(1))[0];
    if (!row || row.lifecycle === "deleted") return res.status(404).json({ ok: false, error: "Listing not found." });
    const isOwner = Boolean(user && (user.role === "admin" || user.id === row.ownerId));
    const hasBid = Boolean(user && (await db.select({ id: proxyBids.id }).from(proxyBids).where(and(eq(proxyBids.listingId, row.listingId), eq(proxyBids.userId, user.id))).limit(1))[0]);
    const isPublic = row.lifecycle === "official" && row.stock > 0;
    if (!isOwner && !hasBid && !isPublic) return res.status(404).json({ ok: false, error: "Listing not found." });
    const seller = (await db.select({ name: users.name, storeName: users.storeName }).from(users).where(eq(users.id, row.ownerId)).limit(1))[0];
    const pendingOffer = Boolean(user && (await db.select({ id: proxyBids.id }).from(proxyBids).where(and(eq(proxyBids.listingId, row.listingId), eq(proxyBids.userId, user.id), eq(proxyBids.status, "offered"))).limit(1))[0]);
    return res.json({ ok: true, listing: { ...toListing(row, seller?.storeName || seller?.name || "MerchantHub seller"), secondChancePending: pendingOffer } });
  });
  app.post("/api/listings", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const body = req.body ?? {};
    const title = String(body.title ?? "").trim(); const description = String(body.description ?? "").trim(); const listingType = body.listingType;
    const lifecycle = body.lifecycle === "draft" ? "draft" : "official";
    const priceCents = Math.round(Number(body.priceCents)); const buyNowPriceCents = body.buyNowPriceCents == null ? null : Math.round(Number(body.buyNowPriceCents)); const stock = Math.round(Number(body.stock));
    if (!title || !description || !["Auction", "Buy now", "Both"].includes(listingType) || !Number.isFinite(priceCents) || priceCents <= 0 || !Number.isFinite(stock) || stock < 1) return res.status(400).json({ ok: false, error: "Title, description, listing type, price, and quantity are required." });
    if (listingType === "Both" && (buyNowPriceCents == null || !Number.isFinite(buyNowPriceCents) || buyNowPriceCents <= 0)) return res.status(400).json({ ok: false, error: "Both listings need a separate Buy-now price." });
    const auction = listingType === "Auction" || listingType === "Both";
    const start = auction && body.auctionStartAt ? new Date(String(body.auctionStartAt)) : null;
    const end = auction && body.auctionEndAt ? new Date(String(body.auctionEndAt)) : null;
    const reserve = auction ? Math.round(Number(body.reserveThresholdCents)) : null; const increment = auction ? Math.round(Number(body.minimumIncrementCents)) : null;
    if (auction && (!end || Number.isNaN(end.getTime()) || end.getTime() <= Date.now() || (start && (Number.isNaN(start.getTime()) || start.getTime() <= Date.now() || start.getTime() >= end.getTime())) || reserve == null || !Number.isFinite(reserve) || reserve < 0 || increment == null || !Number.isFinite(increment) || increment < 100)) return res.status(400).json({ ok: false, error: "Choose a future start (or leave it blank to start now), a later end time, a reserve threshold, and an increment of at least ₱1." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const listingId = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Date.now()}`;
    try {
      const photos = Array.isArray(body.photos) ? body.photos.filter((item: unknown) => typeof item === "string").slice(0, 5) : body.imageData ? [String(body.imageData)] : [];
      await db.insert(listingsOwned).values({ listingId, ownerId: user.id, title, description, category: String(body.category ?? "Other"), subcategory: body.subcategory ? String(body.subcategory) : null, listingType, priceCents, buyNowPriceCents: listingType === "Both" ? buyNowPriceCents : null, stock, condition: body.condition ?? "New", imageData: photos.length ? JSON.stringify(photos) : null, auctionStartAt: start, auctionEndAt: end, reserveThresholdCents: reserve, minimumIncrementCents: increment, antiSnipeSeconds: auction ? Math.max(0, Math.round(Number(body.antiSnipeSeconds ?? 120))) : 0, winnerCancellationAllowed: auction && body.winnerCancellationAllowed === false ? 0 : 1, lifecycle });
      const row = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0];
      if (row) await notifySavedSearchMatches(row);
      return res.status(201).json({ ok: true, listing: row ? toListing(row, user.storeName || user.name) : null });
    } catch (error) {
      console.error("[Listings] Failed to create listing", error);
      return res.status(500).json({ ok: false, error: "Listing could not be saved. Check the Render logs for the database error." });
    }
  });
  app.patch("/api/listings/:listingId", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    await settleExpiredAuctions();
    const row = (await db.select().from(listingsOwned).where(and(eq(listingsOwned.listingId, req.params.listingId), eq(listingsOwned.ownerId, user.id))).limit(1))[0];
    if (!row) return res.status(404).json({ ok: false, error: "Listing not found or you do not own it." });
    const nextLifecycle = req.body?.lifecycle;
    if (nextLifecycle && !["draft", "official"].includes(nextLifecycle)) return res.status(400).json({ ok: false, error: "Invalid listing state." });
    const pendingOffer = (await db.select({ id: proxyBids.id }).from(proxyBids).where(and(eq(proxyBids.listingId, row.listingId), eq(proxyBids.status, "offered"))).limit(1))[0];
    if (pendingOffer && (req.body?.stock !== undefined || req.body?.auctionEndAt !== undefined || nextLifecycle !== undefined)) return res.status(409).json({ ok: false, error: "Resolve the pending second-chance offer before changing stock or listing status." });
    if (nextLifecycle === "official" && ["auction-ended", "sold"].includes(row.lifecycle) && (row.listingType === "Auction" || row.listingType === "Both")) return res.status(409).json({ ok: false, error: "Use Re-auction to start a new auction cycle." });
    const nextStock = req.body?.stock === undefined ? row.stock : Math.round(Number(req.body.stock));
    if (nextLifecycle === "official" && nextStock <= 0) return res.status(409).json({ ok: false, error: "Add available stock before making this listing official." });
    const updates: Partial<typeof listingsOwned.$inferInsert> = {};
    for (const key of ["title", "description", "category", "subcategory", "listingType", "condition", "reserveThresholdCents", "minimumIncrementCents", "antiSnipeSeconds", "stock", "priceCents", "buyNowPriceCents"] as const) if (req.body?.[key] !== undefined) (updates as any)[key] = req.body[key];
    if (req.body?.auctionEndAt !== undefined) {
      if (row.lifecycle !== "official" || (row.listingType !== "Auction" && row.listingType !== "Both")) return res.status(409).json({ ok: false, error: "Only a live official auction can have its deadline changed." });
      const auctionEndAt = new Date(String(req.body.auctionEndAt));
      if (Number.isNaN(auctionEndAt.getTime()) || auctionEndAt.getTime() <= Date.now()) return res.status(400).json({ ok: false, error: "Choose a future auction closing time." });
      updates.auctionEndAt = auctionEndAt;
      updates.settledAt = null;
    }
    if (Array.isArray(req.body?.photos)) updates.imageData = JSON.stringify(req.body.photos.filter((item: unknown) => typeof item === "string").slice(0, 5));
    if (nextLifecycle) updates.lifecycle = nextLifecycle;
    if (req.body?.stock !== undefined && nextStock <= 0 && row.lifecycle === "official") {
      const activeBid = (await db.select({ id: proxyBids.id }).from(proxyBids).where(and(eq(proxyBids.listingId, row.listingId), eq(proxyBids.status, "active"))).limit(1))[0];
      if (!activeBid) updates.lifecycle = "draft";
    }
    if (nextLifecycle === "official" && (row.listingType === "Auction" || row.listingType === "Both") && (!row.auctionEndAt || row.auctionEndAt.getTime() <= Date.now())) {
      updates.auctionEndAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      updates.settledAt = null;
    }
    await db.update(listingsOwned).set(updates).where(eq(listingsOwned.listingId, req.params.listingId));
    const updated = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, req.params.listingId)).limit(1))[0];
    if (updated && (updates.priceCents !== undefined || updates.stock !== undefined)) {
      const watchers = await db.select({ userId: wishlists.userId }).from(wishlists).where(eq(wishlists.listingId, updated.listingId));
      const changed = updates.priceCents !== undefined ? "price" : "inventory";
      await Promise.all(watchers.filter((watcher) => watcher.userId !== updated.ownerId).map((watcher) => createNotification(watcher.userId, "system", changed === "price" ? "Price update on a saved item" : "Inventory update on a saved item", `“${updated.title}” has a ${changed} update in your saved items.`, updated.listingId)));
    }
    if (updated && (updates.auctionStartAt !== undefined || updates.auctionEndAt !== undefined || updates.lifecycle !== undefined)) publishAuctionUpdate(updated.listingId);
    return res.json({ ok: true, listing: updated ? toListing(updated) : null });
  });
  app.post("/api/listings/:listingId/split-auction", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const source = (await db.select().from(listingsOwned).where(and(eq(listingsOwned.listingId, req.params.listingId), eq(listingsOwned.ownerId, user.id))).limit(1))[0];
    if (!source || source.lifecycle !== "official") return res.status(404).json({ ok: false, error: "Choose an official listing to split into auction stock." });
    const auctionQuantity = Math.round(Number(req.body?.quantity));
    if (!Number.isFinite(auctionQuantity) || auctionQuantity < 1 || auctionQuantity >= source.stock) return res.status(400).json({ ok: false, error: `Auction quantity must be between 1 and ${Math.max(1, source.stock - 1)}.` });
    if (req.body?.lifecycle !== undefined && !["draft", "official"].includes(req.body.lifecycle)) return res.status(400).json({ ok: false, error: "Auction status must be draft or official." });
    const lifecycle = req.body?.lifecycle === "draft" ? "draft" : "official";
    const start = req.body?.auctionStartAt ? new Date(String(req.body.auctionStartAt)) : null;
    const end = new Date(String(req.body?.auctionEndAt ?? ""));
    const startingBidCents = Math.round(Number(req.body?.startingBidCents ?? source.priceCents));
    const reserve = Math.round(Number(req.body?.reserveThresholdCents));
    const increment = Math.round(Number(req.body?.minimumIncrementCents));
    if (Number.isNaN(end.getTime()) || end.getTime() <= Date.now() || (start && (Number.isNaN(start.getTime()) || start.getTime() <= Date.now() || start.getTime() >= end.getTime())) || !Number.isFinite(startingBidCents) || startingBidCents <= 0 || !Number.isFinite(reserve) || reserve < 0 || !Number.isFinite(increment) || increment < 100) return res.status(400).json({ ok: false, error: "Choose a valid starting bid, optional future start before the end, reserve, and minimum ₱1 increment." });
    const listingId = `${source.listingId}-auction-${Date.now()}`;
    try {
      await db.transaction(async (tx) => {
        const stockMove = await tx.update(listingsOwned).set({ stock: source.stock - auctionQuantity }).where(and(eq(listingsOwned.listingId, source.listingId), eq(listingsOwned.ownerId, user.id), eq(listingsOwned.lifecycle, "official"), eq(listingsOwned.stock, source.stock)));
        if (stockMove[0]?.affectedRows === 0) throw new Error("INVENTORY_CHANGED");
        await tx.insert(listingsOwned).values({ listingId, ownerId: user.id, title: source.title, description: source.description, category: source.category, listingType: "Auction", priceCents: startingBidCents, buyNowPriceCents: null, stock: auctionQuantity, condition: source.condition, imageData: source.imageData, auctionStartAt: start, auctionEndAt: end, reserveThresholdCents: reserve, minimumIncrementCents: increment, winnerCancellationAllowed: req.body?.winnerCancellationAllowed === false ? 0 : 1, lifecycle });
      });
    } catch (error) {
      if (error instanceof Error && error.message === "INVENTORY_CHANGED") return res.status(409).json({ ok: false, error: "Inventory changed while you were splitting it. Refresh and try again." });
      console.error("[Listings] Failed to split inventory into an auction", error);
      return res.status(500).json({ ok: false, error: "Auction stock could not be split. No inventory change was saved." });
    }
    const created = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0];
    return res.status(201).json({ ok: true, listing: created ? toListing(created, user.storeName || user.name) : null });
  });
  app.post("/api/listings/:listingId/re-auction", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const listing = (await db.select().from(listingsOwned).where(and(eq(listingsOwned.listingId, req.params.listingId), eq(listingsOwned.ownerId, user.id))).limit(1))[0];
    if (!listing || (listing.listingType !== "Auction" && listing.listingType !== "Both")) return res.status(404).json({ ok: false, error: "Auction listing not found." });
    if (listing.lifecycle !== "auction-ended") return res.status(409).json({ ok: false, error: "Only an ended auction without a sale can be re-auctioned." });
    if (listing.stock <= 0) return res.status(409).json({ ok: false, error: "Add stock before re-auctioning this item." });
    const pendingOffer = (await db.select({ id: proxyBids.id }).from(proxyBids).where(and(eq(proxyBids.listingId, listing.listingId), eq(proxyBids.status, "offered"))).limit(1))[0];
    if (pendingOffer) return res.status(409).json({ ok: false, error: "Wait for the second-highest bidder to accept or decline before re-auctioning." });
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const updated = await db.update(listingsOwned).set({ lifecycle: "official", auctionStartAt: null, auctionEndAt: end, settledAt: null }).where(and(eq(listingsOwned.listingId, listing.listingId), eq(listingsOwned.lifecycle, "auction-ended")));
    if (updated[0]?.affectedRows === 0) return res.status(409).json({ ok: false, error: "This auction changed before it could be re-auctioned. Refresh Inventory and try again." });
    await db.update(proxyBids).set({ status: "cancelled", currentBidCents: 0 }).where(eq(proxyBids.listingId, listing.listingId));
    const refreshed = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, listing.listingId)).limit(1))[0];
    publishAuctionUpdate(listing.listingId);
    return res.json({ ok: true, listing: refreshed ? toListing(refreshed, user.storeName || user.name) : null });
  });
  app.delete("/api/listings/:listingId", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const listing = (await db.select({ listingId: listingsOwned.listingId }).from(listingsOwned).where(and(eq(listingsOwned.listingId, req.params.listingId), eq(listingsOwned.ownerId, user.id))).limit(1))[0];
    if (!listing) return res.status(404).json({ ok: false, error: "Listing not found or you do not own it." });
    const pendingOffer = (await db.select({ id: proxyBids.id }).from(proxyBids).where(and(eq(proxyBids.listingId, listing.listingId), eq(proxyBids.status, "offered"))).limit(1))[0];
    if (pendingOffer) return res.status(409).json({ ok: false, error: "Resolve the pending second-chance offer before deleting this item." });
    const result = await db.update(listingsOwned).set({ lifecycle: "deleted" }).where(and(eq(listingsOwned.listingId, req.params.listingId), eq(listingsOwned.ownerId, user.id)));
    return res.json({ ok: true, deleted: result[0]?.affectedRows !== 0 });
  });
};
