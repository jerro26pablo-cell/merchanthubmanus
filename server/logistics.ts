import type { Express, Request, Response } from "express";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "./db";
import { getAppUser } from "./appAuth";
import { commerceOrders, listingsOwned, riderLocations, users } from "../drizzle/schema";
import { createNotification } from "./notifications";

const auth = async (req: Request, res: Response) => {
  const user = await getAppUser(req);
  if (!user) { res.status(401).json({ ok: false, error: "Please log in." }); return undefined; }
  return user;
};
export const registerLogisticsRoutes = (app: Express) => {
  app.post("/api/orders/checkout", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const body = req.body ?? {}; const listingId = String(body.listingId ?? "");
    if (!listingId) return res.status(400).json({ ok: false, error: "Listing is required." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const listing = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0];
    if (!listing || listing.lifecycle !== "official") return res.status(404).json({ ok: false, error: "This listing is no longer available." });
    if (listing.ownerId === user.id) return res.status(403).json({ ok: false, error: "You cannot buy your own listing." });
    const requestedQuantity = Math.round(Number(body.quantity));
    if (!Number.isFinite(requestedQuantity) || requestedQuantity < 1) return res.status(400).json({ ok: false, error: "Choose at least one item." });
    if (requestedQuantity > listing.stock) return res.status(409).json({ ok: false, error: `Only ${listing.stock} item(s) remain in stock.` });
    const orderId = `MH-${Date.now().toString().slice(-6)}`;
    await db.insert(commerceOrders).values({ orderId, listingId, buyerId: user.id, sellerId: listing.ownerId, quantity: requestedQuantity, amountCents: Math.max(0, Math.round(Number(body.amountCents) || 0)), payment: body.payment === "COD" ? "COD" : "Online", province: String(body.province || user.province || "Unknown"), municipality: String(body.municipality || user.municipality || "Unknown"), addressDetails: body.addressDetails ? String(body.addressDetails).slice(0, 240) : null, destinationLatitude: body.destinationLatitude ? String(body.destinationLatitude) : null, destinationLongitude: body.destinationLongitude ? String(body.destinationLongitude) : null, status: "Processing" });
    await db.update(listingsOwned).set({ stock: listing.stock - requestedQuantity }).where(eq(listingsOwned.listingId, listingId));
    await createNotification(user.id, "order_created", "Order placed", `Your order ${orderId} is being prepared for ${body.municipality || user.municipality || "your location"}.`, orderId);
    return res.status(201).json({ ok: true, orderId, location: { province: body.province || user.province, municipality: body.municipality || user.municipality, addressDetails: body.addressDetails || null } });
  });
  app.get("/api/orders/active", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const rows = user.role === "rider" ? await db.select().from(commerceOrders).where(or(eq(commerceOrders.status, "Processing"), eq(commerceOrders.riderId, user.id))) : user.role === "admin" ? await db.select().from(commerceOrders) : await db.select().from(commerceOrders).where(or(eq(commerceOrders.buyerId, user.id), eq(commerceOrders.sellerId, user.id)));
    const orders = await Promise.all(rows.map(async (row) => { const buyer = (await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, row.buyerId)).limit(1))[0]; const seller = (await db.select({ name: users.name, email: users.email, storeName: users.storeName }).from(users).where(eq(users.id, row.sellerId)).limit(1))[0]; return { ...row, buyerName: buyer?.name || buyer?.email || "Buyer", sellerName: seller?.storeName || seller?.name || seller?.email || "Seller" }; }));
    return res.json({ ok: true, orders });
  });
  app.get("/api/orders/:orderId", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const order = (await db.select().from(commerceOrders).where(eq(commerceOrders.orderId, req.params.orderId)).limit(1))[0];
    if (!order || (user.role !== "admin" && user.id !== order.buyerId && user.id !== order.sellerId && user.id !== order.riderId)) return res.status(404).json({ ok: false, error: "Order not found." });
    const buyer = (await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, order.buyerId)).limit(1))[0]; const seller = (await db.select({ name: users.name, email: users.email, storeName: users.storeName }).from(users).where(eq(users.id, order.sellerId)).limit(1))[0];
    return res.json({ ok: true, order: { ...order, buyerName: buyer?.name || buyer?.email || "Buyer", sellerName: seller?.storeName || seller?.name || seller?.email || "Seller" } });
  });
  app.post("/api/orders/:orderId/accept", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    if (user.role !== "rider") return res.status(403).json({ ok: false, error: "Only the rider account can accept deliveries." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const claimed = await db.update(commerceOrders).set({ riderId: user.id, status: "Rider assigned" }).where(and(eq(commerceOrders.orderId, req.params.orderId), eq(commerceOrders.status, "Processing")));
    if (claimed[0]?.affectedRows === 0) return res.status(409).json({ ok: false, error: "Another rider already accepted this order, or it is no longer available." });
    const row = (await db.select().from(commerceOrders).where(eq(commerceOrders.orderId, req.params.orderId)).limit(1))[0];
    if (row) {
      await createNotification(row.buyerId, "delivery_update", "Rider accepted your delivery", `Your order ${row.orderId} was accepted by the rider.`, row.orderId);
      await createNotification(row.sellerId, "delivery_update", "Rider assigned", `A rider accepted pickup for order ${row.orderId}.`, row.orderId);
    }
    return res.json({ ok: true, order: row ?? null });
  });
  app.post("/api/orders/:orderId/cancel-pickup", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    if (user.role !== "rider") return res.status(403).json({ ok: false, error: "Only the assigned rider can cancel a pickup assignment." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const current = (await db.select().from(commerceOrders).where(eq(commerceOrders.orderId, req.params.orderId)).limit(1))[0];
    if (!current) return res.status(404).json({ ok: false, error: "Order not found." });
    if (current.riderId !== user.id || current.status !== "Rider assigned") return res.status(409).json({ ok: false, error: "Pickup can only be cancelled by its assigned rider before the item is picked up." });
    const released = await db.update(commerceOrders).set({ riderId: null, status: "Processing" }).where(and(eq(commerceOrders.orderId, current.orderId), eq(commerceOrders.riderId, user.id), eq(commerceOrders.status, "Rider assigned")));
    if (released[0]?.affectedRows === 0) return res.status(409).json({ ok: false, error: "This pickup assignment already changed. Refresh the queue." });
    await createNotification(current.buyerId, "delivery_update", "Rider cancelled pickup", `The rider could not pick up order ${current.orderId}. Your order is back in the queue for another rider.`, current.orderId);
    await createNotification(current.sellerId, "delivery_update", "Pickup released to rider queue", `The assigned rider cancelled pickup for order ${current.orderId}; another rider can accept it.`, current.orderId);
    return res.json({ ok: true, orderId: current.orderId, status: "Processing" });
  });
  app.post("/api/orders/:orderId/status", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    if (user.role !== "rider" && user.role !== "admin") return res.status(403).json({ ok: false, error: "Only a rider or admin can update delivery status." });
    const nextStatus = req.body?.status;
    if (!["Rider assigned", "Picked up", "In transit", "Delivered", "Cancelled"].includes(nextStatus)) return res.status(400).json({ ok: false, error: "Invalid delivery status." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const current = (await db.select().from(commerceOrders).where(eq(commerceOrders.orderId, req.params.orderId)).limit(1))[0];
    if (!current) return res.status(404).json({ ok: false, error: "Order not found." });
    if (user.role === "rider" && current.riderId !== user.id) return res.status(403).json({ ok: false, error: "This delivery is not assigned to you." });
    const allowed: Record<string, string[]> = { "Rider assigned": ["Picked up"], "Picked up": ["In transit"], "In transit": ["Delivered"] };
    if (user.role === "rider" && !allowed[current.status]?.includes(nextStatus)) return res.status(409).json({ ok: false, error: `A rider cannot move an order from ${current.status} to ${nextStatus}.` });
    const changed = await db.update(commerceOrders).set({ status: nextStatus }).where(and(eq(commerceOrders.orderId, req.params.orderId), eq(commerceOrders.status, current.status), user.role === "rider" ? eq(commerceOrders.riderId, user.id) : eq(commerceOrders.orderId, req.params.orderId)));
    if (changed[0]?.affectedRows === 0) return res.status(409).json({ ok: false, error: "The delivery changed before this update. Refresh the queue." });
    await createNotification(current.buyerId, "delivery_update", `Delivery ${nextStatus.toLowerCase()}`, `Order ${current.orderId} is now ${nextStatus}.`, current.orderId);
    if (current.sellerId) await createNotification(current.sellerId, "delivery_update", `Order ${nextStatus.toLowerCase()}`, `Order ${current.orderId} is now ${nextStatus}.`, current.orderId);
    return res.json({ ok: true, status: nextStatus });
  });
  app.post("/api/rider/location", async (req, res) => {
    const user = await auth(req, res); if (!user || user.role !== "rider") return res.status(403).json({ ok: false, error: "Rider access required." });
    const rawLatitude = req.body?.latitude; const rawLongitude = req.body?.longitude; const latitudeValue = Number(rawLatitude); const longitudeValue = Number(rawLongitude); if (rawLatitude == null || rawLongitude == null || rawLatitude === "" || rawLongitude === "" || !Number.isFinite(latitudeValue) || !Number.isFinite(longitudeValue) || latitudeValue < -90 || latitudeValue > 90 || longitudeValue < -180 || longitudeValue > 180) return res.status(400).json({ ok: false, error: "Valid latitude and longitude are required." }); const latitude = String(latitudeValue); const longitude = String(longitudeValue);
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const requestedOrderId = req.body?.orderId ? String(req.body.orderId) : "";
    const active = requestedOrderId ? (await db.select().from(commerceOrders).where(and(eq(commerceOrders.orderId, requestedOrderId), eq(commerceOrders.riderId, user.id), or(eq(commerceOrders.status, "Rider assigned"), eq(commerceOrders.status, "Picked up"), eq(commerceOrders.status, "In transit")))).limit(1))[0] : undefined;
    await db.insert(riderLocations).values({ riderId: user.id, orderId: active?.orderId ?? null, latitude, longitude, accuracy: req.body?.accuracy ? String(req.body.accuracy) : null, moving: req.body?.moving ? 1 : 0 }).onDuplicateKeyUpdate({ set: { orderId: active?.orderId ?? null, latitude, longitude, accuracy: req.body?.accuracy ? String(req.body.accuracy) : null, moving: req.body?.moving ? 1 : 0 } });
    return res.json({ ok: true, updatedAt: new Date().toISOString(), moving: Boolean(req.body?.moving) });
  });
  app.get("/api/orders/:orderId/location", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const order = (await db.select().from(commerceOrders).where(eq(commerceOrders.orderId, req.params.orderId)).limit(1))[0];
    if (!order || (user.role !== "rider" && user.id !== order.buyerId && user.id !== order.sellerId && user.role !== "admin")) return res.status(404).json({ ok: false, error: "Order not found." });
    const location = (await db.select().from(riderLocations).where(eq(riderLocations.orderId, req.params.orderId)).limit(1))[0];
    return res.json({ ok: true, order, location: location ?? null });
  });
};
