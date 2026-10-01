import type { Express, Request, Response } from "express";
import { and, eq, ne, or } from "drizzle-orm";
import { getDb } from "./db";
import { getAppUser } from "./appAuth";
import { commerceOrders, listingsOwned, proxyBids, users } from "../drizzle/schema";
import { notifySavedSearchMatches } from "./savedSearches";

const requireUser = async (req: Request, res: Response) => {
  const user = await getAppUser(req);
  if (!user) { res.status(401).json({ ok: false, error: "Please log in." }); return undefined; }
  return user;
};
const toListing = (row: typeof listingsOwned.$inferSelect, seller = "") => {
  let photos: string[] = [];
  if (row.imageData) { try { const parsed = JSON.parse(row.imageData); photos = Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [row.imageData]; } catch { photos = [row.imageData]; } }
  return { id: row.listingId, title: row.title, description: row.description, category: row.category, type: row.listingType, price: row.priceCents / 100, startingBid: row.listingType === "Auction" || row.listingType === "Both" ? row.priceCents / 100 : undefined, buyNow: row.listingType === "Buy now" ? row.priceCents / 100 : row.listingType === "Both" ? (row.buyNowPriceCents ?? row.priceCents) / 100 : undefined, stock: row.stock, condition: row.condition, image: photos[0] || "", photos, seller, sellerRating: 5, accent: "coral", auctionEndAt: row.auctionEndAt?.toISOString(), reserveThreshold: row.reserveThresholdCents == null ? undefined : row.reserveThresholdCents / 100, minimumIncrement: row.minimumIncrementCents == null ? undefined : row.minimumIncrementCents / 100, lifecycle: row.lifecycle, ownerId: row.ownerId };
};
export const registerListingRoutes = (app: Express) => {
  app.get("/api/metrics/overview", async (req, res) => {
    const user = await getAppUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "Please log in." });
    const db = await getDb();
    if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const ownerFilter = user.role === "admin" ? undefined : user.id;
    const listingRows = await db.select({ id: listingsOwned.listingId, stock: listingsOwned.stock, type: listingsOwned.listingType, end: listingsOwned.auctionEndAt }).from(listingsOwned).where(ownerFilter ? and(eq(listingsOwned.ownerId, ownerFilter), eq(listingsOwned.lifecycle, "official")) : eq(listingsOwned.lifecycle, "official"));
    const orderRows = user.role === "admin" ? await db.select().from(commerceOrders) : await db.select().from(commerceOrders).where(or(eq(commerceOrders.buyerId, user.id), eq(commerceOrders.sellerId, user.id)));
    const liveAuctions = listingRows.filter((row) => (row.type === "Auction" || row.type === "Both") && (!row.end || row.end.getTime() > Date.now())).length;
    const transitStatuses = new Set(["Processing", "Rider assigned", "Picked up", "In transit"]);
    const inTransit = orderRows.filter((row) => transitStatuses.has(row.status)).length;
    const grossSalesCents = orderRows.filter((row) => row.status !== "Cancelled" && (user.role === "admin" || row.sellerId === user.id)).reduce((sum, row) => sum + row.amountCents, 0);
    return res.json({ ok: true, metrics: { grossSalesCents, liveAuctions, ordersInTransit: inTransit, availableStock: listingRows.reduce((sum, row) => sum + row.stock, 0), skuCount: listingRows.length } });
  });
  app.get("/api/listings", async (req, res) => {
    const user = await getAppUser(req);
    const db = await getDb();
    if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const ownerOnly = req.query.owner === "me";
    const ownerRows = ownerOnly && user ? await db.select().from(listingsOwned).where(eq(listingsOwned.ownerId, user.id)) : await db.select().from(listingsOwned).where(eq(listingsOwned.lifecycle, "official"));
    const rows = ownerOnly ? ownerRows : ownerRows.filter((row) => !(row.listingType === "Auction" || row.listingType === "Both") || !row.auctionEndAt || row.auctionEndAt.getTime() > Date.now());
    const owners = await db.select({ id: users.id, name: users.name, storeName: users.storeName }).from(users);
    const ownerMap = new Map(owners.map((owner) => [owner.id, owner.storeName || owner.name || "MerchantHub seller"]));
    return res.json({ ok: true, listings: rows.map((row) => toListing(row, ownerMap.get(row.ownerId) || "MerchantHub seller")) });
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
    const end = auction && body.auctionEndAt ? new Date(String(body.auctionEndAt)) : null;
    const reserve = auction ? Math.round(Number(body.reserveThresholdCents)) : null; const increment = auction ? Math.round(Number(body.minimumIncrementCents)) : null;
    if (auction && (!end || Number.isNaN(end.getTime()) || reserve == null || !Number.isFinite(reserve) || reserve < 0 || increment == null || !Number.isFinite(increment) || increment < 100)) return res.status(400).json({ ok: false, error: "Choose an auction end time, reserve threshold, and increment of at least ₱1." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const listingId = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Date.now()}`;
    try {
      const photos = Array.isArray(body.photos) ? body.photos.filter((item: unknown) => typeof item === "string").slice(0, 5) : body.imageData ? [String(body.imageData)] : [];
      await db.insert(listingsOwned).values({ listingId, ownerId: user.id, title, description, category: String(body.category ?? "Other"), listingType, priceCents, buyNowPriceCents: listingType === "Both" ? buyNowPriceCents : null, stock, condition: body.condition ?? "New", imageData: photos.length ? JSON.stringify(photos) : null, auctionEndAt: end, reserveThresholdCents: reserve, minimumIncrementCents: increment, lifecycle });
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
    const row = (await db.select().from(listingsOwned).where(and(eq(listingsOwned.listingId, req.params.listingId), eq(listingsOwned.ownerId, user.id))).limit(1))[0];
    if (!row) return res.status(404).json({ ok: false, error: "Listing not found or you do not own it." });
    const nextLifecycle = req.body?.lifecycle;
    if (nextLifecycle && !["draft", "official"].includes(nextLifecycle)) return res.status(400).json({ ok: false, error: "Invalid listing state." });
    const updates: Partial<typeof listingsOwned.$inferInsert> = {};
    for (const key of ["title", "description", "category", "listingType", "condition", "auctionEndAt", "reserveThresholdCents", "minimumIncrementCents", "stock", "priceCents", "buyNowPriceCents"] as const) if (req.body?.[key] !== undefined) (updates as any)[key] = req.body[key];
    if (Array.isArray(req.body?.photos)) updates.imageData = JSON.stringify(req.body.photos.filter((item: unknown) => typeof item === "string").slice(0, 5));
    if (nextLifecycle) updates.lifecycle = nextLifecycle;
    await db.update(listingsOwned).set(updates).where(eq(listingsOwned.listingId, req.params.listingId));
    const updated = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, req.params.listingId)).limit(1))[0];
    return res.json({ ok: true, listing: updated ? toListing(updated) : null });
  });
  app.post("/api/listings/:listingId/split-auction", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const source = (await db.select().from(listingsOwned).where(and(eq(listingsOwned.listingId, req.params.listingId), eq(listingsOwned.ownerId, user.id))).limit(1))[0];
    if (!source || source.lifecycle === "deleted") return res.status(404).json({ ok: false, error: "Listing not found." });
    const auctionQuantity = Math.round(Number(req.body?.quantity));
    if (!Number.isFinite(auctionQuantity) || auctionQuantity < 1 || auctionQuantity >= source.stock) return res.status(400).json({ ok: false, error: `Auction quantity must be between 1 and ${Math.max(1, source.stock - 1)}.` });
    const end = new Date(String(req.body?.auctionEndAt ?? "")); const reserve = Math.round(Number(req.body?.reserveThresholdCents)); const increment = Math.round(Number(req.body?.minimumIncrementCents));
    if (Number.isNaN(end.getTime()) || !Number.isFinite(reserve) || reserve < 0 || !Number.isFinite(increment) || increment < 100) return res.status(400).json({ ok: false, error: "Auction end, reserve, and minimum ₱1 increment are required." });
    const listingId = `${source.listingId}-auction-${Date.now()}`;
    await db.update(listingsOwned).set({ stock: source.stock - auctionQuantity }).where(eq(listingsOwned.listingId, source.listingId));
    await db.insert(listingsOwned).values({ listingId, ownerId: user.id, title: source.title, description: source.description, category: source.category, listingType: "Auction", priceCents: source.priceCents, buyNowPriceCents: null, stock: auctionQuantity, condition: source.condition, imageData: source.imageData, auctionEndAt: end, reserveThresholdCents: reserve, minimumIncrementCents: increment, lifecycle: "official" });
    const created = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0];
    return res.status(201).json({ ok: true, listing: created ? toListing(created, user.storeName || user.name) : null });
  });
  app.post("/api/listings/:listingId/re-auction", async (req, res) => { const user = await requireUser(req, res); if (!user) return; const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." }); const listing = (await db.select().from(listingsOwned).where(and(eq(listingsOwned.listingId, req.params.listingId), eq(listingsOwned.ownerId, user.id))).limit(1))[0]; if (!listing || (listing.listingType !== "Auction" && listing.listingType !== "Both")) return res.status(404).json({ ok: false, error: "Auction listing not found." }); const end = new Date(Date.now() + 24 * 60 * 60 * 1000); await db.update(listingsOwned).set({ lifecycle: "official", auctionEndAt: end, settledAt: null }).where(eq(listingsOwned.listingId, listing.listingId)); await db.update(proxyBids).set({ status: "cancelled", currentBidCents: 0 }).where(eq(proxyBids.listingId, listing.listingId)); const refreshed = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, listing.listingId)).limit(1))[0]; return res.json({ ok: true, listing: refreshed ? toListing(refreshed, user.storeName || user.name) : null }); });
  app.delete("/api/listings/:listingId", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const result = await db.update(listingsOwned).set({ lifecycle: "deleted" }).where(and(eq(listingsOwned.listingId, req.params.listingId), eq(listingsOwned.ownerId, user.id)));
    return res.json({ ok: true, deleted: result[0]?.affectedRows !== 0 });
  });
};
