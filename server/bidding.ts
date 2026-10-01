import type { Express, Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { listingsOwned, proxyBids, users } from "../drizzle/schema";
import { getAppUser } from "./appAuth";
import { createNotification, settleExpiredAuctions } from "./notifications";

const requireUser = async (req: Request, res: Response) => { const user = await getAppUser(req); if (!user) { res.status(401).json({ ok: false, error: "Please log in to use your wallet." }); return undefined; } return user; };
const pesos = (cents: number) => `₱${(cents / 100).toLocaleString("en-PH")}`;
const activeForListing = async (db: NonNullable<Awaited<ReturnType<typeof getDb>>>, listingId: string) => db.select().from(proxyBids).where(and(eq(proxyBids.listingId, listingId), eq(proxyBids.status, "active")));
export function registerBiddingRoutes(app: Express) {
  app.get("/api/wallet", async (req, res) => { const user = await requireUser(req, res); if (!user) return; return res.json({ ok: true, walletCents: user.walletCents }); });
  app.post("/api/wallet/fund", async (req, res) => { const user = await requireUser(req, res); if (!user) return; const amountCents = Math.round(Number(req.body?.amountCents)); if (!Number.isFinite(amountCents) || amountCents < 10000 || amountCents > 100000000) return res.status(400).json({ ok: false, error: "Demo top-ups must be between ₱100 and ₱1,000,000." }); const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." }); const nextBalance = user.walletCents + amountCents; await db.update(users).set({ walletCents: nextBalance }).where(eq(users.id, user.id)); return res.json({ ok: true, walletCents: nextBalance }); });
  app.get("/api/bids/history", async (req, res) => { const listingId = String(req.query.listingId ?? ""); if (!listingId) return res.status(400).json({ ok: false, error: "listingId is required." }); const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." }); const rows = await db.select().from(proxyBids).where(eq(proxyBids.listingId, listingId)).orderBy(desc(proxyBids.createdAt)).limit(50); const history = await Promise.all(rows.map(async (row) => { const user = (await db.select({ name: users.name }).from(users).where(eq(users.id, row.userId)).limit(1))[0]; return { id: row.id, bidder: user?.name || `Bidder ${row.userId}`, userId: row.userId, amountCents: row.currentBidCents, maxBidCents: row.maxBidCents, status: row.status, createdAt: row.createdAt }; })); return res.json({ ok: true, listingId, history }); });
  app.get("/api/bids/current", async (req, res) => { await settleExpiredAuctions(); const listingId = String(req.query.listingId ?? ""); const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." }); const rows = await activeForListing(db, listingId); const currentBidCents = rows.reduce((highest, row) => Math.max(highest, row.currentBidCents), 0); return res.json({ ok: true, listingId, currentBidCents, hasBids: rows.length > 0 }); });
  app.get("/api/bids/proxy", async (req, res) => { const user = await requireUser(req, res); if (!user) return; const listingId = String(req.query.listingId ?? ""); const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." }); const rows = await db.select().from(proxyBids).where(and(eq(proxyBids.userId, user.id), eq(proxyBids.listingId, listingId), eq(proxyBids.status, "active"))).limit(1); const all = await activeForListing(db, listingId); const currentBidCents = all.reduce((highest, row) => Math.max(highest, row.currentBidCents), 0); return res.json({ ok: true, proxy: rows[0] ?? null, walletCents: user.walletCents, currentBidCents }); });
  app.post("/api/bids/proxy", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const listingId = String(req.body?.listingId ?? ""); const maxBidCents = Math.round(Number(req.body?.maxBidCents)); const incrementCents = Math.round(Number(req.body?.incrementCents));
    if (!listingId || !Number.isFinite(maxBidCents) || !Number.isFinite(incrementCents) || incrementCents < 100) return res.status(400).json({ ok: false, error: "Listing, max bid, and a minimum increment of at least ₱1 are required." });
    if (maxBidCents > user.walletCents) return res.status(400).json({ ok: false, error: `Your max bid cannot exceed your e-wallet balance of ${pesos(user.walletCents)}.` });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const listing = (await db.select({ ownerId: listingsOwned.ownerId, priceCents: listingsOwned.priceCents, auctionEndAt: listingsOwned.auctionEndAt }).from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0];
    if (!listing) return res.status(404).json({ ok: false, error: "Auction listing not found." });
    if (listing.ownerId === user.id) return res.status(403).json({ ok: false, error: "You cannot bid on your own listing." });
    if (listing.auctionEndAt && listing.auctionEndAt.getTime() <= Date.now()) return res.status(409).json({ ok: false, error: "This auction has ended." });
    const initialBidCents = Math.round(Number(req.body?.bidCents));
    const active = await activeForListing(db, listingId);
    const currentBidCents = active.reduce((highest, row) => Math.max(highest, row.currentBidCents), listing.priceCents);
    const requiredBid = currentBidCents + incrementCents;
    if (maxBidCents < requiredBid) { await createNotification(user.id, "system", "Proxy bid limit reached", `The next bid would be ${pesos(requiredBid)}, above your maximum of ${pesos(maxBidCents)}. Increase your maximum bid to continue.`, listingId); return res.status(409).json({ ok: false, error: `Your maximum bid is below the next increment of ${pesos(requiredBid)}.`, limitReached: true }); }
    if (maxBidCents < initialBidCents) return res.status(400).json({ ok: false, error: "Your maximum bid must be at least your opening bid." });
    if (!Number.isFinite(initialBidCents) || initialBidCents < requiredBid) return res.status(400).json({ ok: false, error: `Your bid must be at least ${pesos(requiredBid)}.` });
    await db.update(proxyBids).set({ status: "outbid" }).where(and(eq(proxyBids.listingId, listingId), eq(proxyBids.userId, user.id), eq(proxyBids.status, "active")));
    const [created] = await db.insert(proxyBids).values({ userId: user.id, listingId, maxBidCents, incrementCents, currentBidCents: initialBidCents, status: "active" }).$returningId();
    const proxies = await activeForListing(db, listingId);
    proxies.sort((a, b) => b.maxBidCents - a.maxBidCents || a.id - b.id);
    const winner = proxies[0]; const runner = proxies[1];
    const winningCurrent = Math.min(winner.maxBidCents, Math.max(initialBidCents, runner ? runner.maxBidCents + winner.incrementCents : initialBidCents));
    await db.update(proxyBids).set({ currentBidCents: 0 }).where(and(eq(proxyBids.listingId, listingId), eq(proxyBids.status, "active")));
    await db.update(proxyBids).set({ currentBidCents: winningCurrent }).where(eq(proxyBids.id, winner.id));
    const row = (await db.select().from(proxyBids).where(eq(proxyBids.id, created.id)).limit(1))[0];
    return res.json({ ok: true, proxy: row, walletCents: user.walletCents, currentBidCents: winningCurrent, leadingUserId: winner.userId });
  });
}
