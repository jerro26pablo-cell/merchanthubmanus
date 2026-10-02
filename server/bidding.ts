import type { Express, Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { bidCancellationRequests, listingsOwned, proxyBids, users } from "../drizzle/schema";
import { getAppUser } from "./appAuth";
import { createNotification, settleExpiredAuctions } from "./notifications";
import { calculateProxyWinningBidCents, createBidderLabels, rankCurrentProxyBids, selectAuctionSummaryBid, selectSecondChanceBid, secondChanceTransition } from "./auctionState";

const requireUser = async (req: Request, res: Response) => {
  const user = await getAppUser(req);
  if (!user) { res.status(401).json({ ok: false, error: "Please log in to use your wallet." }); return undefined; }
  return user;
};
const pesos = (cents: number) => `₱${(cents / 100).toLocaleString("en-PH")}`;
const activeForListing = async (db: NonNullable<Awaited<ReturnType<typeof getDb>>>, listingId: string) => db.select().from(proxyBids).where(and(eq(proxyBids.listingId, listingId), eq(proxyBids.status, "active")));
const auctionStatus = (row: typeof proxyBids.$inferSelect, listing: typeof listingsOwned.$inferSelect) => {
  const ended = Boolean(listing.auctionEndAt && listing.auctionEndAt.getTime() <= Date.now());
  const bidderStatus = row.status === "offered" ? "Second chance offered" : ended ? row.status === "won" ? "Won" : "Lost" : row.status === "active" && row.currentBidCents > 0 ? "Winning" : "Losing";
  return { auctionState: ended ? "Auction ended" : "Auction ongoing", bidderStatus };
};

export async function getBidHistoryForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  await settleExpiredAuctions();
  const rows = await db.select().from(proxyBids).where(eq(proxyBids.userId, userId)).orderBy(desc(proxyBids.createdAt), desc(proxyBids.id)).limit(100);
  const listingRows = await db.select().from(listingsOwned);
  const listingMap = new Map(listingRows.map((listing) => [listing.listingId, listing]));
  return rows.map((row) => {
    const listing = listingMap.get(row.listingId);
    const state = listing ? auctionStatus(row, listing) : { auctionState: "Auction ended", bidderStatus: "Lost" };
    return { ...row, listingTitle: listing?.title ?? row.listingId, listingType: listing?.listingType ?? "Auction", auctionEndAt: listing?.auctionEndAt?.toISOString() ?? null, ...state };
  });
}

export function registerBiddingRoutes(app: Express) {
  app.get("/api/wallet", async (req, res) => { const user = await requireUser(req, res); if (!user) return; return res.json({ ok: true, walletCents: user.walletCents }); });
  app.post("/api/wallet/fund", async (req, res) => { const user = await requireUser(req, res); if (!user) return; const amountCents = Math.round(Number(req.body?.amountCents)); if (!Number.isFinite(amountCents) || amountCents < 10000 || amountCents > 100000000) return res.status(400).json({ ok: false, error: "Demo top-ups must be between ₱100 and ₱1,000,000." }); const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." }); const nextBalance = user.walletCents + amountCents; await db.update(users).set({ walletCents: nextBalance }).where(eq(users.id, user.id)); return res.json({ ok: true, walletCents: nextBalance }); });
  app.get("/api/bids/history", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    await settleExpiredAuctions();
    const listingId = String(req.query.listingId ?? "");
    if (!listingId) return res.status(400).json({ ok: false, error: "listingId is required." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const listing = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0];
    if (!listing) return res.status(404).json({ ok: false, error: "Auction listing not found." });
    const isSeller = user.role === "admin" || listing.ownerId === user.id;
    const rows = await db.select().from(proxyBids).where(eq(proxyBids.listingId, listingId)).orderBy(desc(proxyBids.createdAt), desc(proxyBids.id));
    const aliases = createBidderLabels([...rows].sort((a, b) => a.id - b.id).map((row) => row.userId), user.id);
    const latestOwn = rows.find((row) => row.userId === user.id);
    const leader = rows.filter((row) => row.status === "active").sort((a, b) => b.currentBidCents - a.currentBidCents || a.id - b.id)[0];
    const ended = Boolean(listing.auctionEndAt && listing.auctionEndAt.getTime() <= Date.now());
    const viewerBidStatus = !latestOwn ? "You have not bid" : latestOwn.status === "won" ? "Winner" : latestOwn.status === "offered" ? "Second-chance offer" : latestOwn.status === "active" ? "Winning" : ended ? "Auction ended" : latestOwn.status === "outbid" ? "Outbid" : "Not currently bidding";
    const visibleRows = rows.slice(0, 50);
    const history = await Promise.all(visibleRows.map(async (row) => {
      const bidder = isSeller ? (await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, row.userId)).limit(1))[0] : undefined;
      const { userId: bidderUserId, maxBidCents, ...publicFields } = row;
      const displayStatus = row.status === "active" ? "Winning" : row.status === "won" ? "Winner" : row.status === "offered" ? "Second-chance offer" : row.status === "outbid" ? "Outbid" : "Resolved";
      return {
        ...publicFields,
        ...(isSeller ? { userId: bidderUserId, maxBidCents } : row.userId === user.id ? { maxBidCents } : {}),
        amountCents: isSeller || row.userId === user.id ? (row.currentBidCents || maxBidCents) : row.currentBidCents,
        bidder: isSeller ? `${bidder?.name || bidder?.email || `Bidder ${bidderUserId}`} · ${aliases.get(bidderUserId) ?? "Bidder"}` : aliases.get(bidderUserId) ?? "Bidder",
        isCurrentUser: row.userId === user.id,
        displayStatus,
        listingTitle: listing.title,
      };
    }));
    return res.json({ ok: true, listingId, viewer: isSeller ? "seller" : "buyer", viewerBidStatus, viewerBidCurrentCents: latestOwn?.currentBidCents ?? 0, viewerMaxBidCents: latestOwn?.maxBidCents ?? 0, currentBidCents: leader?.currentBidCents ?? listing.priceCents, history });
  });
  app.get("/api/bids/my-history", async (req, res) => { const user = await requireUser(req, res); if (!user) return; return res.json({ ok: true, history: await getBidHistoryForUser(user.id) }); });
  app.get("/api/bids/stream", async (req, res) => { const user = await requireUser(req, res); if (!user) return; const listingId = String(req.query.listingId ?? ""); if (!listingId) return res.status(400).json({ ok: false, error: "listingId is required." }); const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." }); res.setHeader("Content-Type", "text/event-stream"); res.setHeader("Cache-Control", "no-cache"); res.setHeader("Connection", "keep-alive"); const publish = async () => { const rows = await activeForListing(db, listingId); const currentBidCents = rows.reduce((highest, row) => Math.max(highest, row.currentBidCents), 0); res.write(`data: ${JSON.stringify({ listingId, currentBidCents, activeBids: rows.length, updatedAt: new Date().toISOString() })}\n\n`); }; await publish(); const timer = setInterval(publish, 2000); req.on("close", () => clearInterval(timer)); });
  app.get("/api/bids/current", async (req, res) => { await settleExpiredAuctions(); const listingId = String(req.query.listingId ?? ""); const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." }); const rows = await activeForListing(db, listingId); const currentBidCents = rows.reduce((highest, row) => Math.max(highest, row.currentBidCents), 0); return res.json({ ok: true, listingId, currentBidCents, hasBids: rows.length > 0 }); });
  app.get("/api/bids/summary", async (req, res) => { const user = await requireUser(req, res); if (!user) return; await settleExpiredAuctions(); const listingId = String(req.query.listingId ?? ""); const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." }); const listing = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0]; if (!listing) return res.status(404).json({ ok: false, error: "Auction listing not found." }); if (user.role !== "admin" && listing.ownerId !== user.id) return res.status(403).json({ ok: false, error: "Only the seller can view the auction summary." }); const rows = await db.select().from(proxyBids).where(eq(proxyBids.listingId, listingId)).orderBy(desc(proxyBids.currentBidCents), desc(proxyBids.createdAt)); const leader = selectAuctionSummaryBid(rows); const leaderUser = leader ? (await db.select({ name: users.name }).from(users).where(eq(users.id, leader.userId)).limit(1))[0] : undefined; return res.json({ ok: true, listingId, bidCount: rows.length, activeBidCount: rows.filter((row) => row.status === "active").length, currentBidCents: leader?.currentBidCents ?? listing.priceCents, leadingBidder: leader ? { userId: leader.userId, name: leaderUser?.name ?? `Bidder ${leader.userId}`, status: leader.status, maxBidCents: leader.maxBidCents } : null }); });
  app.get("/api/bids/proxy", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const listingId = String(req.query.listingId ?? "");
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const rows = await db.select().from(proxyBids).where(and(eq(proxyBids.userId, user.id), eq(proxyBids.listingId, listingId))).orderBy(desc(proxyBids.createdAt), desc(proxyBids.id)).limit(1);
    const latest = rows[0];
    const proxy = latest && latest.isAutomatic === 1 && (latest.status === "active" || latest.status === "outbid") ? latest : null;
    const all = await activeForListing(db, listingId);
    const currentBidCents = all.reduce((highest, row) => Math.max(highest, row.currentBidCents), 0);
    return res.json({ ok: true, proxy, walletCents: user.walletCents, currentBidCents });
  });
  app.post("/api/bids/proxy", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const listingId = String(req.body?.listingId ?? ""); const mode = req.body?.mode === "simple" ? "simple" : "proxy"; const initialBidCents = Math.round(Number(req.body?.bidCents)); let maxBidCents = Math.round(Number(req.body?.maxBidCents)); let incrementCents = Math.round(Number(req.body?.incrementCents));
    if (!listingId || !Number.isFinite(initialBidCents) || initialBidCents <= 0 || (mode === "proxy" && (!Number.isFinite(maxBidCents) || !Number.isFinite(incrementCents) || incrementCents < 100))) return res.status(400).json({ ok: false, error: mode === "simple" ? "Enter a valid bid amount." : "Listing, max bid, and an increment of at least ₱1 are required." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const listing = (await db.select({ ownerId: listingsOwned.ownerId, listingType: listingsOwned.listingType, stock: listingsOwned.stock, priceCents: listingsOwned.priceCents, auctionEndAt: listingsOwned.auctionEndAt, title: listingsOwned.title, minimumIncrementCents: listingsOwned.minimumIncrementCents, antiSnipeSeconds: listingsOwned.antiSnipeSeconds, lifecycle: listingsOwned.lifecycle }).from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0];
    if (!listing) return res.status(404).json({ ok: false, error: "Auction listing not found." });
    if (listing.ownerId === user.id) return res.status(403).json({ ok: false, error: "You cannot bid on your own listing." });
    if (listing.lifecycle !== "official") return res.status(409).json({ ok: false, error: "This auction is no longer active." });
    if (listing.listingType !== "Auction" && listing.listingType !== "Both") return res.status(409).json({ ok: false, error: "This listing is not available for auction bidding." });
    if (listing.stock <= 0) return res.status(409).json({ ok: false, error: "This auction is out of stock and cannot accept bids." });
    if (listing.auctionEndAt && listing.auctionEndAt.getTime() <= Date.now()) return res.status(409).json({ ok: false, error: "This auction has ended." });
    const active = await activeForListing(db, listingId);
    const currentBidCents = active.reduce((highest, row) => Math.max(highest, row.currentBidCents), listing.priceCents);
    const sellerMinimumIncrement = Math.max(100, listing.minimumIncrementCents ?? 100);
    if (mode === "simple") { maxBidCents = initialBidCents; incrementCents = sellerMinimumIncrement; }
    if (maxBidCents > user.walletCents) return res.status(400).json({ ok: false, error: `Your max bid cannot exceed your e-wallet balance of ${pesos(user.walletCents)}.` });
    if (mode === "simple" && incrementCents < sellerMinimumIncrement) return res.status(400).json({ ok: false, error: `Your bid must follow the seller minimum increment of ${pesos(sellerMinimumIncrement)}.` });
    const requiredBid = active.length ? currentBidCents + sellerMinimumIncrement : listing.priceCents;
    if (maxBidCents < requiredBid) { await createNotification(user.id, "system", "Proxy bid limit reached", `The next bid would be ${pesos(requiredBid)}, above your maximum of ${pesos(maxBidCents)}. Increase your maximum bid to continue.`, listingId); return res.status(409).json({ ok: false, error: `Your maximum bid is below the next increment of ${pesos(requiredBid)}.`, limitReached: true }); }
    if (maxBidCents < initialBidCents) return res.status(400).json({ ok: false, error: "Your maximum bid must be at least your opening bid." });
    if (!Number.isFinite(initialBidCents) || initialBidCents < requiredBid) return res.status(400).json({ ok: false, error: `Your bid must be at least ${pesos(requiredBid)}.` });
    const antiSnipeSeconds = Math.max(0, listing.antiSnipeSeconds ?? 0);
    const remainingSeconds = listing.auctionEndAt ? Math.floor((listing.auctionEndAt.getTime() - Date.now()) / 1000) : Number.MAX_SAFE_INTEGER;
    if (antiSnipeSeconds > 0 && remainingSeconds > 0 && remainingSeconds <= antiSnipeSeconds) {
      const extendedEnd = new Date(listing.auctionEndAt!.getTime() + antiSnipeSeconds * 1000);
      await db.update(listingsOwned).set({ auctionEndAt: extendedEnd, settledAt: null }).where(eq(listingsOwned.listingId, listingId));
      listing.auctionEndAt = extendedEnd;
      await createNotification(listing.ownerId, "system", "Auction extended", `A last-second bid extended “${listing.title}” by ${antiSnipeSeconds} seconds.`, listingId);
    }
    await db.update(proxyBids).set({ status: "outbid", currentBidCents: 0 }).where(and(eq(proxyBids.listingId, listingId), eq(proxyBids.userId, user.id), eq(proxyBids.status, "active")));
    const [created] = await db.insert(proxyBids).values({ userId: user.id, listingId, maxBidCents, incrementCents, currentBidCents: initialBidCents, isAutomatic: mode === "proxy" ? 1 : 0, status: "active" }).$returningId();
    const allBids = await db.select().from(proxyBids).where(eq(proxyBids.listingId, listingId));
    const proxies = rankCurrentProxyBids(allBids);
    const winner = proxies[0]; const runner = proxies[1];
    const winningCurrent = calculateProxyWinningBidCents(winner, runner, initialBidCents, listing.priceCents, sellerMinimumIncrement);
    await db.update(proxyBids).set({ status: "outbid", currentBidCents: 0 }).where(and(eq(proxyBids.listingId, listingId), eq(proxyBids.status, "active")));
    await db.update(proxyBids).set({ status: "active", currentBidCents: winningCurrent }).where(eq(proxyBids.id, winner.id));
    for (const proxy of proxies) {
      if (proxy.id === winner.id) await createNotification(proxy.userId, "system", "You are winning", `You are currently leading “${listing.title}” at ${pesos(winningCurrent)}. Your current bid cap is ${pesos(proxy.maxBidCents)}.`, listingId);
      else await createNotification(proxy.userId, "system", "You were outbid", `Your bid on “${listing.title}” is losing at ${pesos(winningCurrent)}. Increase your maximum bid to continue.`, listingId);
    }
    const row = (await db.select().from(proxyBids).where(eq(proxyBids.id, created.id)).limit(1))[0];
    return res.json({ ok: true, proxy: row, walletCents: user.walletCents, currentBidCents: winningCurrent, leadingUserId: winner.userId });
  });
  app.post("/api/bids/:bidId/cancel", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    await settleExpiredAuctions();
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const bid = (await db.select().from(proxyBids).where(and(eq(proxyBids.id, Number(req.params.bidId)), eq(proxyBids.userId, user.id))).limit(1))[0];
    if (!bid || bid.status !== "won") return res.status(404).json({ ok: false, error: "Only your won auction can be cancelled here." });
    const cancelled = await db.update(proxyBids).set({ status: "cancelled", currentBidCents: 0 }).where(and(eq(proxyBids.id, bid.id), eq(proxyBids.status, "won")));
    if (cancelled[0]?.affectedRows === 0) return res.status(409).json({ ok: false, error: "This winning bid has already been resolved." });
    const listing = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, bid.listingId)).limit(1))[0];
    if (!listing) return res.status(404).json({ ok: false, error: "Auction listing not found." });
    await db.update(listingsOwned).set({ lifecycle: "auction-ended", stock: listing.stock + 1 }).where(and(eq(listingsOwned.listingId, listing.listingId), eq(listingsOwned.lifecycle, "sold")));
    const rows = await db.select().from(proxyBids).where(eq(proxyBids.listingId, bid.listingId)).orderBy(desc(proxyBids.createdAt));
    const runner = selectSecondChanceBid(rows, user.id);
    let offerSent = false;
    if (runner) {
      const offered = await db.update(proxyBids).set({ status: "offered", currentBidCents: runner.maxBidCents }).where(and(eq(proxyBids.id, runner.id), eq(proxyBids.status, "outbid")));
      offerSent = offered[0]?.affectedRows !== 0;
    }
    await createNotification(user.id, "system", "Auction cancellation confirmed", `Your winning bid for “${listing.title}” was cancelled.`, listing.listingId);
    if (offerSent && runner) {
      await createNotification(runner.userId, "system", "Second-chance offer", `The winning buyer cancelled “${listing.title}”. You were the next-highest bidder, so the item is offered to you at ${pesos(runner.maxBidCents)}. Accept or decline this offer from your notification.`, listing.listingId);
      await createNotification(listing.ownerId, "system", "Winner cancelled — second chance offered", `The winning buyer cancelled “${listing.title}”. A second-chance offer is waiting for the next-highest bidder.`, listing.listingId);
    } else {
      await db.update(listingsOwned).set({ lifecycle: "auction-ended" }).where(eq(listingsOwned.listingId, listing.listingId));
      await createNotification(listing.ownerId, "system", "Auction ended without a sale", `The winning buyer cancelled “${listing.title}” and no eligible second-highest bidder remains. It is in Inventory → Auction ended and can be re-auctioned or deleted.`, listing.listingId);
    }
    return res.json({ ok: true, secondChanceUserId: offerSent ? runner?.userId ?? null : null, offerSent });
  });
  app.post("/api/bids/:bidId/cancellation-request", async (req, res) => { const user = await requireUser(req, res); if (!user) return; const reason = String(req.body?.reason ?? "").trim().slice(0, 500); if (!reason) return res.status(400).json({ ok: false, error: "A cancellation reason is required." }); const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." }); const bid = (await db.select().from(proxyBids).where(and(eq(proxyBids.id, Number(req.params.bidId)), eq(proxyBids.userId, user.id))).limit(1))[0]; if (!bid || bid.status !== "active") return res.status(409).json({ ok: false, error: "Only an active bid can be submitted for cancellation." }); const existing = (await db.select().from(bidCancellationRequests).where(and(eq(bidCancellationRequests.bidId, bid.id), eq(bidCancellationRequests.status, "pending"))).limit(1))[0]; if (existing) return res.json({ ok: true, request: existing, existing: true }); const result = await db.insert(bidCancellationRequests).values({ bidId: bid.id, listingId: bid.listingId, userId: user.id, reason }).$returningId(); const request = (await db.select().from(bidCancellationRequests).where(eq(bidCancellationRequests.id, result[0].id)).limit(1))[0]; const listing = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, bid.listingId)).limit(1))[0]; if (listing) await createNotification(listing.ownerId, "system", "Bid cancellation request", `A buyer requested cancellation for “${listing.title}”: ${reason}`, bid.listingId); return res.status(201).json({ ok: true, request }); });
  app.get("/api/bids/cancellation-requests", async (req, res) => { const user = await requireUser(req, res); if (!user) return; const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." }); const all = await db.select().from(bidCancellationRequests); const owned = user.role === "admin" ? all : all.filter((request) => request.userId === user.id || request.listingId); const ownedListings = user.role === "admin" ? new Set(all.map((request) => request.listingId)) : new Set((await db.select({ listingId: listingsOwned.listingId }).from(listingsOwned).where(eq(listingsOwned.ownerId, user.id))).map((row) => row.listingId)); return res.json({ ok: true, requests: owned.filter((request) => user.role === "admin" || request.userId === user.id || ownedListings.has(request.listingId)) }); });
  app.patch("/api/bids/cancellation-requests/:requestId", async (req, res) => { const user = await requireUser(req, res); if (!user) return; const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." }); const request = (await db.select().from(bidCancellationRequests).where(eq(bidCancellationRequests.id, Number(req.params.requestId))).limit(1))[0]; if (!request) return res.status(404).json({ ok: false, error: "Cancellation request not found." }); const listing = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, request.listingId)).limit(1))[0]; if (user.role !== "admin" && listing?.ownerId !== user.id) return res.status(403).json({ ok: false, error: "Only the seller or an admin can decide this request." }); const status = req.body?.status === "approved" ? "approved" : req.body?.status === "denied" ? "denied" : null; if (!status) return res.status(400).json({ ok: false, error: "Status must be approved or denied." }); await db.update(bidCancellationRequests).set({ status }).where(eq(bidCancellationRequests.id, request.id)); if (status === "approved") await db.update(proxyBids).set({ status: "cancelled", currentBidCents: 0 }).where(eq(proxyBids.id, request.bidId)); await createNotification(request.userId, "system", `Bid cancellation ${status}`, `Your bid cancellation request for “${listing?.title ?? request.listingId}” was ${status}.`, request.listingId); return res.json({ ok: true, status }); });
  app.get("/api/bids/second-chance/offers", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const offeredBids = await db.select().from(proxyBids).where(and(eq(proxyBids.userId, user.id), eq(proxyBids.status, "offered"))).orderBy(desc(proxyBids.createdAt));
    const offers = await Promise.all(offeredBids.map(async (bid) => {
      const listing = (await db.select({ title: listingsOwned.title, category: listingsOwned.category }).from(listingsOwned).where(eq(listingsOwned.listingId, bid.listingId)).limit(1))[0];
      return { bidId: bid.id, listingId: bid.listingId, amountCents: bid.currentBidCents, title: listing?.title ?? bid.listingId, category: listing?.category ?? "Auction" };
    }));
    return res.json({ ok: true, offers });
  });
  app.post("/api/bids/second-chance/accept", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const listingId = String(req.body?.listingId ?? "");
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const runner = (await db.select().from(proxyBids).where(and(eq(proxyBids.listingId, listingId), eq(proxyBids.userId, user.id), eq(proxyBids.status, "offered"))).orderBy(desc(proxyBids.createdAt)).limit(1))[0];
    if (!runner) return res.status(404).json({ ok: false, error: "No second-chance offer is available for this account." });
    const listing = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0];
    if (!listing || listing.lifecycle !== "auction-ended") return res.status(409).json({ ok: false, error: "This second-chance offer is no longer available." });
    const transition = secondChanceTransition("accept");
    const changed = await db.update(proxyBids).set({ status: transition.bidStatus, currentBidCents: runner.currentBidCents || runner.maxBidCents }).where(and(eq(proxyBids.id, runner.id), eq(proxyBids.status, "offered")));
    if (changed[0]?.affectedRows === 0) return res.status(409).json({ ok: false, error: "This offer has already been answered." });
    await db.update(listingsOwned).set({ lifecycle: transition.listingLifecycle, stock: Math.max(0, listing.stock - 1) }).where(and(eq(listingsOwned.listingId, listingId), eq(listingsOwned.lifecycle, "auction-ended")));
    await createNotification(listing.ownerId, "auction_won", "Second-chance offer accepted", `The next-highest bidder accepted “${listing.title}” at ${pesos(runner.currentBidCents || runner.maxBidCents)}.`, listingId);
    await createNotification(user.id, "auction_won", "You are the winner of this item", `You accepted “${listing.title}” at ${pesos(runner.currentBidCents || runner.maxBidCents)}. Open your auction detail to review the item, seller, and winning amount.`, listingId);
    return res.json({ ok: true, listingId, status: "won" });
  });
  app.post("/api/bids/second-chance/decline", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const listingId = String(req.body?.listingId ?? "");
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const runner = (await db.select().from(proxyBids).where(and(eq(proxyBids.listingId, listingId), eq(proxyBids.userId, user.id), eq(proxyBids.status, "offered"))).orderBy(desc(proxyBids.createdAt)).limit(1))[0];
    if (!runner) return res.status(404).json({ ok: false, error: "No second-chance offer is available for this account." });
    const listing = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0];
    if (!listing || listing.lifecycle !== "auction-ended") return res.status(409).json({ ok: false, error: "This second-chance offer is no longer available." });
    const transition = secondChanceTransition("decline");
    const changed = await db.update(proxyBids).set({ status: transition.bidStatus, currentBidCents: 0 }).where(and(eq(proxyBids.id, runner.id), eq(proxyBids.status, "offered")));
    if (changed[0]?.affectedRows === 0) return res.status(409).json({ ok: false, error: "This offer has already been answered." });
    await db.update(listingsOwned).set({ lifecycle: transition.listingLifecycle }).where(and(eq(listingsOwned.listingId, listingId), eq(listingsOwned.lifecycle, "auction-ended")));
    await createNotification(listing.ownerId, "system", "Second-chance offer declined", `The next-highest bidder declined “${listing.title}”. The auction is ended without a sale; you can re-auction it from Inventory.`, listingId);
    await createNotification(user.id, "system", "Second-chance offer declined", `You declined the offer for “${listing.title}”.`, listingId);
    return res.json({ ok: true, listingId, status: "declined" });
  });
}
