import type { Express, Request, Response } from "express";
import { and, eq, gte, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { getAppUser } from "./appAuth";
import { commerceOrders, listingSizeVariants, listingsOwned, riderLocations, users } from "../drizzle/schema";
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
    const requestedQuantity = Number(body.quantity);
    if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity < 1) return res.status(400).json({ ok: false, error: "Choose at least one whole item." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const orderId = `MH-${Date.now().toString().slice(-6)}`;
    let result;
    try { result = await db.transaction(async (tx) => {
      const listing = (await tx.select().from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0];
      if (!listing || listing.lifecycle !== "official") return { error: "This listing is no longer available.", status: 404 as const };
      if (listing.listingType !== "Buy now") return { error: "Auction listings must be purchased through the bidding process.", status: 409 as const };
      if (listing.ownerId === user.id) return { error: "You cannot buy your own listing.", status: 403 as const };
      const variants = await tx.select().from(listingSizeVariants).where(eq(listingSizeVariants.listingId, listingId));
      const requestedSize = String(body.size ?? "").trim();
      const requestedColor = String(body.color ?? "").trim();
      if (variants.length && !requestedSize) return { error: "Choose a size before checking out.", status: 400 as const };
      const matchingSize = variants.filter((item) => item.size.toLocaleLowerCase() === requestedSize.toLocaleLowerCase());
      if (matchingSize.length > 1 && !requestedColor) return { error: "Choose a color for that size before checking out.", status: 400 as const };
      const variant = requestedSize ? matchingSize.find((item) => (item.color ?? "").toLocaleLowerCase() === requestedColor.toLocaleLowerCase()) : undefined;
      if (requestedSize && !variant) return { error: "That size/color option is no longer available. Refresh the listing and choose another.", status: 409 as const };
      const unitPriceCents = variant?.priceCents ?? listing.priceCents;
      const availableStock = variant?.stock ?? listing.stock;
      if (requestedQuantity > availableStock) return { error: `Only ${availableStock} item(s) remain in ${variant?.size ? `size ${variant.size}` : "stock"}.`, status: 409 as const };
      const moved = variant
        ? await tx.update(listingSizeVariants).set({ stock: sql`${listingSizeVariants.stock} - ${requestedQuantity}` }).where(and(eq(listingSizeVariants.id, variant.id), gte(listingSizeVariants.stock, requestedQuantity)))
        : null;
      if (moved && moved[0]?.affectedRows === 0) throw new Error("SIZE_STOCK_CHANGED");
      const listingMoved = await tx.update(listingsOwned).set({ stock: sql`${listingsOwned.stock} - ${requestedQuantity}` }).where(and(eq(listingsOwned.listingId, listingId), gte(listingsOwned.stock, requestedQuantity), eq(listingsOwned.lifecycle, "official")));
      if (listingMoved[0]?.affectedRows === 0) throw new Error("LISTING_STOCK_CHANGED");
      await tx.insert(commerceOrders).values({ orderId, listingId, buyerId: user.id, sellerId: listing.ownerId, quantity: requestedQuantity, variantSize: variant?.size ?? null, variantColor: variant?.color || null, unitPriceCents, amountCents: unitPriceCents * requestedQuantity, payment: body.payment === "COD" ? "COD" : "Online", province: String(body.province || user.province || "Unknown"), municipality: String(body.municipality || user.municipality || "Unknown"), addressDetails: body.addressDetails ? String(body.addressDetails).slice(0, 240) : null, destinationLatitude: body.destinationLatitude ? String(body.destinationLatitude) : null, destinationLongitude: body.destinationLongitude ? String(body.destinationLongitude) : null, status: "Processing" });
      return { orderId, province: body.province || user.province, municipality: body.municipality || user.municipality, addressDetails: body.addressDetails || null, amountCents: unitPriceCents * requestedQuantity, size: variant?.size ?? null, color: variant?.color || null };
    }); } catch (error) {
      if (error instanceof Error && error.message === "SIZE_STOCK_CHANGED") return res.status(409).json({ ok: false, error: "That size's stock changed during checkout. Refresh and try again." });
      if (error instanceof Error && error.message === "LISTING_STOCK_CHANGED") return res.status(409).json({ ok: false, error: "Listing stock changed during checkout. Refresh and try again." });
      throw error;
    }
    if ("error" in result) return res.status(result.status ?? 409).json({ ok: false, error: result.error });
    await createNotification(user.id, "order_created", "Order placed", `Your order ${orderId}${result.size ? ` for size ${result.size}${result.color ? ` · ${result.color}` : ""}` : ""} is being prepared for ${result.municipality || user.municipality || "your location"}.`, orderId);
    return res.status(201).json({ ok: true, orderId, amountCents: result.amountCents, location: { province: result.province, municipality: result.municipality, addressDetails: result.addressDetails } });
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
