import type { Express, Request, Response } from "express";
import { and, eq, ne, or } from "drizzle-orm";
import { getDb } from "./db";
import { getAppUser } from "./appAuth";
import { commerceOrders, listingPriceHistory, listingsOwned, proxyBids, users, wishlists } from "../drizzle/schema";
import { createNotification, settleExpiredAuctions } from "./notifications";
import { notifySavedSearchMatches } from "./savedSearches";
import { publishAuctionUpdate } from "./auctionEvents";
import { notifyFollowedStoreUpcomingAuction } from "./stores";
import { listingTypeChangeBlock } from "./listingEditRules";

const requireUser = async (req: Request, res: Response) => {
  const user = await getAppUser(req);
  if (!user) { res.status(401).json({ ok: false, error: "Please log in." }); return undefined; }
  return user;
};
const toListing = (row: typeof listingsOwned.$inferSelect, seller = "", sellerProvince?: string | null, sellerMunicipality?: string | null) => {
  let photos: string[] = [];
  if (row.imageData) { try { const parsed = JSON.parse(row.imageData); photos = Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [row.imageData]; } catch { photos = [row.imageData]; } }
  return { id: row.listingId, title: row.title, description: row.description, category: row.category, subcategory: row.subcategory ?? undefined, type: row.listingType, price: row.priceCents / 100, startingBid: row.listingType === "Auction" ? row.priceCents / 100 : undefined, stock: row.stock, condition: row.condition, image: photos[0] || "", photos, seller, sellerRating: 5, accent: "coral", auctionStartAt: row.auctionStartAt?.toISOString(), auctionEndAt: row.auctionEndAt?.toISOString(), reserveThreshold: row.reserveThresholdCents == null ? undefined : row.reserveThresholdCents / 100, minimumIncrement: row.minimumIncrementCents == null ? undefined : row.minimumIncrementCents / 100, antiSnipeSeconds: row.antiSnipeSeconds ?? 120, winnerCancellationAllowed: Boolean(row.winnerCancellationAllowed), lifecycle: row.lifecycle, settledAt: row.settledAt?.toISOString(), ownerId: row.ownerId, sellerProvince: sellerProvince ?? undefined, sellerMunicipality: sellerMunicipality ?? undefined };
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
    const liveAuctions = listingRows.filter((row) => row.stock > 0 && row.type === "Auction" && (!row.start || row.start.getTime() <= Date.now()) && (!row.end || row.end.getTime() > Date.now())).length;
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
    const rows = ownerOnly ? ownerRows : ownerRows.filter((row) => row.stock > 0 && (row.listingType !== "Auction" || !row.auctionEndAt || row.auctionEndAt.getTime() > Date.now()));
    const owners = await db.select({ id: users.id, name: users.name, storeName: users.storeName, province: users.province, municipality: users.municipality }).from(users);
    const ownerMap = new Map(owners.map((owner) => [owner.id, owner]));
    const pendingOffers = new Set((await db.select({ listingId: proxyBids.listingId }).from(proxyBids).where(eq(proxyBids.status, "offered"))).map((row) => row.listingId));
    return res.json({ ok: true, listings: rows.map((row) => { const owner = ownerMap.get(row.ownerId); return { ...toListing(row, owner?.storeName || owner?.name || "MerchantHub seller", owner?.province, owner?.municipality), secondChancePending: pendingOffers.has(row.listingId) }; }) });
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
    const seller = (await db.select({ name: users.name, storeName: users.storeName, province: users.province, municipality: users.municipality }).from(users).where(eq(users.id, row.ownerId)).limit(1))[0];
    const pendingOffer = Boolean(user && (await db.select({ id: proxyBids.id }).from(proxyBids).where(and(eq(proxyBids.listingId, row.listingId), eq(proxyBids.userId, user.id), eq(proxyBids.status, "offered"))).limit(1))[0]);
    return res.json({ ok: true, listing: { ...toListing(row, seller?.storeName || seller?.name || "MerchantHub seller", seller?.province, seller?.municipality), secondChancePending: pendingOffer } });
  });
  app.post("/api/listings", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const body = req.body ?? {};
    const title = String(body.title ?? "").trim(); const description = String(body.description ?? "").trim(); const listingType = body.listingType;
    const lifecycle = body.lifecycle === "draft" ? "draft" : "official";
    const priceCents = Math.round(Number(body.priceCents)); const stock = Math.round(Number(body.stock));
    if (!title || !description || !["Auction", "Buy now"].includes(listingType) || !Number.isFinite(priceCents) || priceCents <= 0 || !Number.isFinite(stock) || stock < 1) return res.status(400).json({ ok: false, error: "Title, description, listing type, price, and quantity are required." });
    const auction = listingType === "Auction";
    const start = auction && body.auctionStartAt ? new Date(String(body.auctionStartAt)) : null;
    const end = auction && body.auctionEndAt ? new Date(String(body.auctionEndAt)) : null;
    const reserve = auction ? Math.round(Number(body.reserveThresholdCents)) : null; const increment = auction ? Math.round(Number(body.minimumIncrementCents)) : null;
    if (auction && (!end || Number.isNaN(end.getTime()) || end.getTime() <= Date.now() || (start && (Number.isNaN(start.getTime()) || start.getTime() <= Date.now() || start.getTime() >= end.getTime())) || reserve == null || !Number.isFinite(reserve) || reserve < 0 || increment == null || !Number.isFinite(increment) || increment < 100)) return res.status(400).json({ ok: false, error: "Choose a future start (or leave it blank to start now), a later end time, a reserve threshold, and an increment of at least ₱1." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const listingId = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Date.now()}`;
    try {
      const photos = Array.isArray(body.photos) ? body.photos.filter((item: unknown) => typeof item === "string").slice(0, 5) : body.imageData ? [String(body.imageData)] : [];
      await db.insert(listingsOwned).values({ listingId, ownerId: user.id, title, description, category: String(body.category ?? "Other"), subcategory: body.subcategory ? String(body.subcategory) : null, listingType, priceCents, stock, condition: body.condition ?? "New", imageData: photos.length ? JSON.stringify(photos) : null, auctionStartAt: start, auctionEndAt: end, reserveThresholdCents: reserve, minimumIncrementCents: increment, antiSnipeSeconds: auction ? Math.max(0, Math.round(Number(body.antiSnipeSeconds ?? 120))) : 0, winnerCancellationAllowed: auction && body.winnerCancellationAllowed === false ? 0 : 1, lifecycle });
      const row = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0];
      if (row) {
        await notifySavedSearchMatches(row);
        await notifyFollowedStoreUpcomingAuction(row);
      }
      return res.status(201).json({ ok: true, listing: row ? toListing(row, user.storeName || user.name, user.province, user.municipality) : null });
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
    const body = req.body ?? {};
    const nextLifecycle = body.lifecycle;
    const requestedListingType = body.listingType;
    if (requestedListingType !== undefined && requestedListingType !== "Auction" && requestedListingType !== "Buy now") return res.status(400).json({ ok: false, error: "Listing type must be Buy now or Auction." });
    if (nextLifecycle && !["draft", "official", "canceled"].includes(nextLifecycle)) return res.status(400).json({ ok: false, error: "Invalid listing state." });
    const targetType = requestedListingType ?? row.listingType;
    const typeChanged = targetType !== row.listingType;
    const pendingOffer = (await db.select({ id: proxyBids.id }).from(proxyBids).where(and(eq(proxyBids.listingId, row.listingId), eq(proxyBids.status, "offered"))).limit(1))[0];
    if (pendingOffer && Object.keys(body).length > 0) return res.status(409).json({ ok: false, error: "Resolve the pending second-chance offer before editing this listing." });
    let hasBidHistory = false;
    if (typeChanged || (body.priceCents !== undefined && row.listingType === "Auction")) {
      hasBidHistory = Boolean((await db.select({ id: proxyBids.id }).from(proxyBids).where(eq(proxyBids.listingId, row.listingId)).limit(1))[0]);
    }
    if (typeChanged) {
      const blocked = listingTypeChangeBlock(row.lifecycle, hasBidHistory);
      if (blocked === "closed") return res.status(409).json({ ok: false, error: "Listing type can only be changed while a listing is a draft or active." });
      if (blocked === "bids") return res.status(409).json({ ok: false, error: "Listing type cannot be changed after an auction has bidding history." });
    }
    if (hasBidHistory && row.listingType === "Auction") {
      const startAt = body.auctionStartAt == null || body.auctionStartAt === "" ? null : new Date(String(body.auctionStartAt)).getTime();
      const rowStartAt = row.auctionStartAt?.getTime() ?? null;
      const changesProtectedTerms = (body.priceCents !== undefined && Math.round(Number(body.priceCents)) !== row.priceCents)
        || (body.reserveThresholdCents !== undefined && Number(body.reserveThresholdCents) !== (row.reserveThresholdCents ?? 0))
        || (body.minimumIncrementCents !== undefined && Number(body.minimumIncrementCents) !== (row.minimumIncrementCents ?? 1000))
        || (body.antiSnipeSeconds !== undefined && Number(body.antiSnipeSeconds) !== (row.antiSnipeSeconds ?? 120))
        || (body.winnerCancellationAllowed !== undefined && Number(Boolean(body.winnerCancellationAllowed)) !== Number(Boolean(row.winnerCancellationAllowed)))
        || (Object.prototype.hasOwnProperty.call(body, "auctionStartAt") && (startAt === null ? rowStartAt !== null : rowStartAt === null || !Number.isFinite(startAt) || Math.abs(startAt - rowStartAt) >= 60_000));
      if (changesProtectedTerms) return res.status(409).json({ ok: false, error: "Auction terms cannot be changed after bidding starts. You can still edit the description, category, and photos." });
    }
    if (nextLifecycle === "official" && ["auction-ended", "sold", "canceled"].includes(row.lifecycle) && row.listingType === "Auction") return res.status(409).json({ ok: false, error: "Use Re-auction to start a new auction cycle." });

    const nextStock = body.stock === undefined ? row.stock : Number(body.stock);
    if (body.stock !== undefined && (!Number.isInteger(nextStock) || nextStock < 0)) return res.status(400).json({ ok: false, error: "Quantity must be a whole number of zero or more." });
    if (nextLifecycle === "official" && nextStock <= 0) return res.status(409).json({ ok: false, error: "Add available stock before making this listing official." });

    const updates: Partial<typeof listingsOwned.$inferInsert> = {};
    const textField = (key: "title" | "description" | "category" | "subcategory", maxLength: number) => {
      if (body[key] === undefined) return undefined;
      if (key === "subcategory" && (body[key] === null || String(body[key]).trim() === "")) return null;
      const value = String(body[key]).trim();
      if (!value || value.length > maxLength) return null;
      return value;
    };
    for (const [key, max] of [["title", 180], ["description", 65535], ["category", 80], ["subcategory", 100]] as const) {
      if (key === "subcategory" && body[key] !== undefined && (body[key] === null || String(body[key]).trim() === "")) { updates.subcategory = null; continue; }
      const value = textField(key, max);
      if (value === null) return res.status(400).json({ ok: false, error: `${key[0].toUpperCase()}${key.slice(1)} is required and must be within its maximum length.` });
      if (value !== undefined) (updates as any)[key] = value;
    }
    if (body.condition !== undefined) {
      if (!["New", "Like new", "Good"].includes(body.condition)) return res.status(400).json({ ok: false, error: "Choose a valid item condition." });
      updates.condition = body.condition;
    }
    if (body.stock !== undefined) updates.stock = nextStock;
    if (requestedListingType !== undefined) updates.listingType = requestedListingType;
    if (body.priceCents !== undefined) {
      const priceCents = Number(body.priceCents);
      if (!Number.isInteger(priceCents) || priceCents <= 0) return res.status(400).json({ ok: false, error: "Enter a valid listing price greater than zero." });
      updates.priceCents = priceCents;
    }
    if (Array.isArray(body.photos)) {
      const photos = body.photos.filter((item: unknown): item is string => typeof item === "string").slice(0, 5);
      if (photos.some((photo: string) => photo.length > 7_200_000)) return res.status(400).json({ ok: false, error: "Each product photo must be 5 MB or smaller." });
      updates.imageData = JSON.stringify(photos);
    }

    if (targetType === "Auction") {
      const hasStartField = Object.prototype.hasOwnProperty.call(body, "auctionStartAt");
      const hasEndField = Object.prototype.hasOwnProperty.call(body, "auctionEndAt");
      const dateValue = (value: unknown): Date | null => value == null || value === "" ? null : new Date(String(value));
      let startAt = hasStartField ? dateValue(body.auctionStartAt) : typeChanged ? null : row.auctionStartAt;
      let endAt = hasEndField ? dateValue(body.auctionEndAt) : typeChanged ? null : row.auctionEndAt;
      if ((startAt && Number.isNaN(startAt.getTime())) || (endAt && Number.isNaN(endAt.getTime()))) return res.status(400).json({ ok: false, error: "Enter valid auction start and end times." });
      if (typeChanged && !endAt) return res.status(400).json({ ok: false, error: "Set a closing time before changing this listing to Auction." });
      if (hasEndField && (!endAt || endAt.getTime() <= Date.now())) return res.status(400).json({ ok: false, error: "Choose a future auction closing time." });
      if (startAt && endAt && startAt.getTime() >= endAt.getTime()) return res.status(400).json({ ok: false, error: "The auction must start before it closes." });
      if (typeChanged && startAt && startAt.getTime() <= Date.now()) return res.status(400).json({ ok: false, error: "A new auction start time must be in the future." });
      if (nextLifecycle === "official" && (!endAt || endAt.getTime() <= Date.now())) {
        endAt = new Date(Math.max(Date.now(), startAt?.getTime() ?? Date.now()) + 24 * 60 * 60 * 1000);
        updates.settledAt = null;
      }
      if (typeChanged || hasStartField) updates.auctionStartAt = startAt;
      if (typeChanged || hasEndField || nextLifecycle === "official") updates.auctionEndAt = endAt;
      const reserveCents = body.reserveThresholdCents === undefined ? typeChanged ? 0 : row.reserveThresholdCents ?? 0 : Number(body.reserveThresholdCents);
      const incrementCents = body.minimumIncrementCents === undefined ? typeChanged ? 1000 : row.minimumIncrementCents ?? 1000 : Number(body.minimumIncrementCents);
      const antiSnipeSeconds = body.antiSnipeSeconds === undefined ? typeChanged ? 120 : row.antiSnipeSeconds ?? 120 : Number(body.antiSnipeSeconds);
      if (!Number.isInteger(reserveCents) || reserveCents < 0 || !Number.isInteger(incrementCents) || incrementCents <= 0 || !Number.isInteger(antiSnipeSeconds) || antiSnipeSeconds < 0) return res.status(400).json({ ok: false, error: "Enter a valid reserve, minimum increment, and anti-sniping interval." });
      if (typeChanged || body.reserveThresholdCents !== undefined) updates.reserveThresholdCents = reserveCents;
      if (typeChanged || body.minimumIncrementCents !== undefined) updates.minimumIncrementCents = incrementCents;
      if (typeChanged || body.antiSnipeSeconds !== undefined) updates.antiSnipeSeconds = antiSnipeSeconds;
      if (body.winnerCancellationAllowed !== undefined && typeof body.winnerCancellationAllowed !== "boolean") return res.status(400).json({ ok: false, error: "Choose a valid winner-cancellation policy." });
      if (typeChanged || body.winnerCancellationAllowed !== undefined) updates.winnerCancellationAllowed = (body.winnerCancellationAllowed ?? (typeChanged ? true : Boolean(row.winnerCancellationAllowed))) ? 1 : 0;
      if (typeChanged || hasEndField) updates.settledAt = null;
    } else if (typeChanged) {
      updates.auctionStartAt = null;
      updates.auctionEndAt = null;
      updates.reserveThresholdCents = null;
      updates.minimumIncrementCents = null;
      updates.antiSnipeSeconds = 0;
      updates.winnerCancellationAllowed = 1;
      updates.settledAt = null;
    }

    if (nextLifecycle) updates.lifecycle = nextLifecycle;
    if (body.stock !== undefined && nextStock <= 0 && row.lifecycle === "official") {
      const activeBid = (await db.select({ id: proxyBids.id }).from(proxyBids).where(and(eq(proxyBids.listingId, row.listingId), eq(proxyBids.status, "active"))).limit(1))[0];
      if (!activeBid) updates.lifecycle = "draft";
    }
    await db.update(listingsOwned).set(updates).where(eq(listingsOwned.listingId, req.params.listingId));
    const updated = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, req.params.listingId)).limit(1))[0];
    if (updated) {
      const priceChanged = row.priceCents !== updated.priceCents;
      const stockChanged = row.stock !== updated.stock;
      if (priceChanged) await db.insert(listingPriceHistory).values({ listingId: updated.listingId, sellerId: updated.ownerId, previousPriceCents: row.priceCents, newPriceCents: updated.priceCents });
      if (priceChanged || stockChanged) {
        const watchers = await db.select({ userId: wishlists.userId }).from(wishlists).where(eq(wishlists.listingId, updated.listingId));
        const previous = row.priceCents;
        const next = updated.priceCents;
        const direction = next > previous ? "increased" : next < previous ? "dropped" : "changed";
        const message = priceChanged ? `“${updated.title}” listing price ${direction} from ₱${(previous / 100).toLocaleString("en-PH")} to ₱${(next / 100).toLocaleString("en-PH")}.` : `“${updated.title}” has an inventory update in your saved items.`;
        const title = priceChanged ? `Saved item price ${direction}` : "Inventory update on a saved item";
        await Promise.all(watchers.filter((watcher) => watcher.userId !== updated.ownerId).map((watcher) => createNotification(watcher.userId, "system", title, message, updated.listingId)));
      }
      const searchCriteriaChanged = row.title !== updated.title || row.description !== updated.description || row.category !== updated.category || row.listingType !== updated.listingType;
      if (updated.lifecycle === "official" && (row.lifecycle !== "official" || searchCriteriaChanged)) await notifySavedSearchMatches(updated);
      if (updated.lifecycle === "official" && updated.listingType === "Auction" && (row.lifecycle !== "official" || row.listingType !== updated.listingType || row.auctionStartAt?.getTime() !== updated.auctionStartAt?.getTime())) await notifyFollowedStoreUpcomingAuction(updated);
      if (updates.auctionStartAt !== undefined || updates.auctionEndAt !== undefined || updates.lifecycle !== undefined || updates.listingType !== undefined) publishAuctionUpdate(updated.listingId);
    }
    return res.json({ ok: true, listing: updated ? toListing(updated, user.storeName || user.name, user.province, user.municipality) : null });
  });
  app.post("/api/listings/:listingId/split-auction", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const source = (await db.select().from(listingsOwned).where(and(eq(listingsOwned.listingId, req.params.listingId), eq(listingsOwned.ownerId, user.id))).limit(1))[0];
    if (!source || source.lifecycle !== "official" || source.listingType !== "Buy now") return res.status(404).json({ ok: false, error: "Choose an official Buy now listing to split into auction stock." });
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
        await tx.insert(listingsOwned).values({ listingId, ownerId: user.id, title: source.title, description: source.description, category: source.category, listingType: "Auction", priceCents: startingBidCents, stock: auctionQuantity, condition: source.condition, imageData: source.imageData, auctionStartAt: start, auctionEndAt: end, reserveThresholdCents: reserve, minimumIncrementCents: increment, winnerCancellationAllowed: req.body?.winnerCancellationAllowed === false ? 0 : 1, lifecycle });
      });
    } catch (error) {
      if (error instanceof Error && error.message === "INVENTORY_CHANGED") return res.status(409).json({ ok: false, error: "Inventory changed while you were splitting it. Refresh and try again." });
      console.error("[Listings] Failed to split inventory into an auction", error);
      return res.status(500).json({ ok: false, error: "Auction stock could not be split. No inventory change was saved." });
    }
    const created = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0];
    if (created && lifecycle === "official") {
      await notifySavedSearchMatches(created);
      await notifyFollowedStoreUpcomingAuction(created);
    }
    return res.status(201).json({ ok: true, listing: created ? toListing(created, user.storeName || user.name, user.province, user.municipality) : null });
  });
  app.post("/api/listings/:listingId/re-auction", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const listing = (await db.select().from(listingsOwned).where(and(eq(listingsOwned.listingId, req.params.listingId), eq(listingsOwned.ownerId, user.id))).limit(1))[0];
    if (!listing || listing.listingType !== "Auction") return res.status(404).json({ ok: false, error: "Auction listing not found." });
    if (!["auction-ended", "canceled"].includes(listing.lifecycle)) return res.status(409).json({ ok: false, error: "Only an ended or canceled auction can be re-auctioned." });
    if (listing.stock <= 0) return res.status(409).json({ ok: false, error: "Add stock before re-auctioning this item." });
    const pendingOffer = (await db.select({ id: proxyBids.id }).from(proxyBids).where(and(eq(proxyBids.listingId, listing.listingId), eq(proxyBids.status, "offered"))).limit(1))[0];
    if (pendingOffer) return res.status(409).json({ ok: false, error: "Wait for the second-highest bidder to accept or decline before re-auctioning." });
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const updated = await db.update(listingsOwned).set({ lifecycle: "official", auctionStartAt: null, auctionEndAt: end, settledAt: null }).where(and(eq(listingsOwned.listingId, listing.listingId), or(eq(listingsOwned.lifecycle, "auction-ended"), eq(listingsOwned.lifecycle, "canceled"))));
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
