import type { Express, Request, Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { getAppUser } from "./appAuth";
import { commerceOrders, listingsOwned, marketplaceRatings, sellerReports, users } from "../drizzle/schema";

const auth = async (req: Request, res: Response) => {
  const user = await getAppUser(req);
  if (!user) { res.status(401).json({ ok: false, error: "Please log in." }); return undefined; }
  return user;
};
const admin = (user: { role: string; email: string }) => user.role === "admin" && user.email.toLowerCase() === "admin@gmail.com";

export const registerTrustRoutes = (app: Express) => {
  app.post("/api/ratings", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const orderId = String(req.body?.orderId ?? "").trim();
    const target = req.body?.target === "seller" ? "seller" : req.body?.target === "item" ? "item" : "";
    const rating = Number(req.body?.rating);
    const comment = String(req.body?.comment ?? "").trim().slice(0, 500) || null;
    if (!orderId || !target || !Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ ok: false, error: "Choose an order, item or seller, and a rating from 1 to 5." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Ratings are unavailable because the database is offline." });
    const order = (await db.select().from(commerceOrders).where(eq(commerceOrders.orderId, orderId)).limit(1))[0];
    if (!order || order.buyerId !== user.id || order.status !== "Delivered") return res.status(403).json({ ok: false, error: "Only the buyer of a delivered order can rate it." });
    const existing = (await db.select({ id: marketplaceRatings.id }).from(marketplaceRatings).where(and(eq(marketplaceRatings.orderId, orderId), eq(marketplaceRatings.buyerId, user.id), eq(marketplaceRatings.target, target))).limit(1))[0];
    if (existing) return res.status(409).json({ ok: false, error: `You already rated this ${target}.` });
    await db.insert(marketplaceRatings).values({ orderId, listingId: order.listingId, buyerId: user.id, sellerId: order.sellerId, target, rating, comment });
    return res.status(201).json({ ok: true });
  });
  app.get("/api/ratings/listing/:listingId", async (req, res) => {
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Ratings are unavailable." });
    const rows = await db.select().from(marketplaceRatings).where(and(eq(marketplaceRatings.listingId, req.params.listingId), eq(marketplaceRatings.target, "item"))).orderBy(desc(marketplaceRatings.createdAt));
    return res.json({ ok: true, ratings: rows });
  });
  app.get("/api/ratings/seller/:sellerId", async (req, res) => {
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Ratings are unavailable." });
    const sellerId = Number(req.params.sellerId); if (!Number.isSafeInteger(sellerId)) return res.status(400).json({ ok: false, error: "Seller not found." });
    const rows = await db.select().from(marketplaceRatings).where(and(eq(marketplaceRatings.sellerId, sellerId), eq(marketplaceRatings.target, "seller"))).orderBy(desc(marketplaceRatings.createdAt));
    const average = rows.length ? rows.reduce((sum, row) => sum + row.rating, 0) / rows.length : 0;
    return res.json({ ok: true, average: Number(average.toFixed(2)), ratings: rows });
  });
  app.post("/api/reports/seller", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const sellerId = Number(req.body?.sellerId); const reason = String(req.body?.reason ?? "").trim().slice(0, 160); const details = String(req.body?.details ?? "").trim().slice(0, 1000) || null; const listingId = req.body?.listingId ? String(req.body.listingId).slice(0, 128) : null;
    if (!Number.isSafeInteger(sellerId) || sellerId <= 0 || sellerId === user.id || !reason) return res.status(400).json({ ok: false, error: "Choose a seller and provide a report reason." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Reports are unavailable because the database is offline." });
    const seller = (await db.select({ id: users.id }).from(users).where(eq(users.id, sellerId)).limit(1))[0]; if (!seller) return res.status(404).json({ ok: false, error: "Seller not found." });
    await db.insert(sellerReports).values({ sellerId, reporterId: user.id, listingId, reason, details });
    return res.status(201).json({ ok: true });
  });
  app.get("/api/admin/seller-reports", async (req, res) => {
    const user = await auth(req, res); if (!user || !admin(user)) return res.status(403).json({ ok: false, error: "Admin access is required." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Reports are unavailable." });
    const rows = await db.select({ report: sellerReports, sellerName: users.name, sellerEmail: users.email }).from(sellerReports).leftJoin(users, eq(users.id, sellerReports.sellerId)).orderBy(desc(sellerReports.createdAt));
    return res.json({ ok: true, reports: rows.map((row) => ({ ...row.report, sellerName: row.sellerName ?? row.sellerEmail ?? "Seller" })) });
  });
  app.patch("/api/admin/seller-reports/:id", async (req, res) => {
    const user = await auth(req, res); if (!user || !admin(user)) return res.status(403).json({ ok: false, error: "Admin access is required." });
    const status = ["open", "reviewed", "dismissed"].includes(req.body?.status) ? req.body.status : null; if (!status) return res.status(400).json({ ok: false, error: "Invalid report status." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Reports are unavailable." });
    await db.update(sellerReports).set({ status }).where(eq(sellerReports.id, Number(req.params.id)));
    return res.json({ ok: true, status });
  });
};
