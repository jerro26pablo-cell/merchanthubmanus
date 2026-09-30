import type { Express, Request, Response } from "express";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "./db";
import { getAppUser } from "./appAuth";
import { listingsOwned } from "../drizzle/schema";

const requireUser = async (req: Request, res: Response) => {
  const user = await getAppUser(req);
  if (!user) { res.status(401).json({ ok: false, error: "Please log in." }); return undefined; }
  return user;
};
const toListing = (row: typeof listingsOwned.$inferSelect) => ({ id: row.listingId, title: row.title, description: row.description, category: row.category, type: row.listingType, price: row.priceCents / 100, startingBid: row.listingType === "Auction" || row.listingType === "Both" ? row.priceCents / 100 : undefined, buyNow: row.listingType === "Buy now" || row.listingType === "Both" ? row.priceCents / 100 : undefined, stock: row.stock, condition: row.condition, image: row.imageData || "", seller: "", sellerRating: 5, accent: "coral", auctionEndAt: row.auctionEndAt?.toISOString(), reserveThreshold: row.reserveThresholdCents == null ? undefined : row.reserveThresholdCents / 100, minimumIncrement: row.minimumIncrementCents == null ? undefined : row.minimumIncrementCents / 100, lifecycle: row.lifecycle, ownerId: row.ownerId });
export const registerListingRoutes = (app: Express) => {
  app.get("/api/listings", async (req, res) => {
    const user = await getAppUser(req);
    const db = await getDb();
    if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const ownerOnly = req.query.owner === "me";
    const ownerRows = ownerOnly && user ? await db.select().from(listingsOwned).where(and(eq(listingsOwned.ownerId, user.id), ne(listingsOwned.lifecycle, "deleted"))) : await db.select().from(listingsOwned).where(eq(listingsOwned.lifecycle, "official"));
    const rows = ownerOnly ? ownerRows : ownerRows.filter((row) => !(row.listingType === "Auction" || row.listingType === "Both") || !row.auctionEndAt || row.auctionEndAt.getTime() > Date.now());
    return res.json({ ok: true, listings: rows.map(toListing) });
  });
  app.post("/api/listings", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const body = req.body ?? {};
    const title = String(body.title ?? "").trim(); const description = String(body.description ?? "").trim(); const listingType = body.listingType;
    const lifecycle = body.lifecycle === "draft" ? "draft" : "official";
    const priceCents = Math.round(Number(body.priceCents)); const stock = Math.round(Number(body.stock));
    if (!title || !description || !["Auction", "Buy now", "Both"].includes(listingType) || !Number.isFinite(priceCents) || priceCents <= 0 || !Number.isFinite(stock) || stock < 1) return res.status(400).json({ ok: false, error: "Title, description, listing type, price, and quantity are required." });
    const auction = listingType === "Auction" || listingType === "Both";
    const end = auction && body.auctionEndAt ? new Date(String(body.auctionEndAt)) : null;
    const reserve = auction ? Math.round(Number(body.reserveThresholdCents)) : null; const increment = auction ? Math.round(Number(body.minimumIncrementCents)) : null;
    if (auction && (!end || Number.isNaN(end.getTime()) || reserve == null || !Number.isFinite(reserve) || reserve < 0 || increment == null || !Number.isFinite(increment) || increment < 100)) return res.status(400).json({ ok: false, error: "Choose an auction end time, reserve threshold, and increment of at least ₱1." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const listingId = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Date.now()}`;
    try {
      await db.insert(listingsOwned).values({ listingId, ownerId: user.id, title, description, category: String(body.category ?? "Other"), listingType, priceCents, stock, condition: body.condition ?? "New", imageData: body.imageData ? String(body.imageData) : null, auctionEndAt: end, reserveThresholdCents: reserve, minimumIncrementCents: increment, lifecycle });
      const row = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0];
      return res.status(201).json({ ok: true, listing: row ? toListing(row) : null });
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
    for (const key of ["title", "description", "category", "listingType", "condition", "imageData", "auctionEndAt", "reserveThresholdCents", "minimumIncrementCents", "stock", "priceCents"] as const) if (req.body?.[key] !== undefined) (updates as any)[key] = req.body[key];
    if (nextLifecycle) updates.lifecycle = nextLifecycle;
    await db.update(listingsOwned).set(updates).where(eq(listingsOwned.listingId, req.params.listingId));
    const updated = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, req.params.listingId)).limit(1))[0];
    return res.json({ ok: true, listing: updated ? toListing(updated) : null });
  });
  app.delete("/api/listings/:listingId", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const result = await db.update(listingsOwned).set({ lifecycle: "deleted" }).where(and(eq(listingsOwned.listingId, req.params.listingId), eq(listingsOwned.ownerId, user.id)));
    return res.json({ ok: true, deleted: result[0]?.affectedRows !== 0 });
  });
};
