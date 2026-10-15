import type { Express, Request, Response } from "express";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "./db";
import { auctionBidEventBatches, bidCancellationRequests, commerceOrders, listingSizeVariants, listingsOwned, paymentOrders, proxyBids, users } from "../drizzle/schema";
import { getAppUser } from "./appAuth";
import { createNotification, settleExpiredAuctions } from "./notifications";
import { buildProxyBidLadderEvents, calculateProxyWinningBidCents, createBidderLabels, getMinimumNextBidCents, getAuctionPhase, rankCurrentProxyBids, selectAuctionSummaryBid, selectSecondChanceBid, secondChanceTransition, resolveWinnerCancellation } from "./auctionState";
import { publishAuctionUpdate, subscribeAuctionUpdates } from "./auctionEvents";
import { calculateAuctionHoldChange, getSpendableWalletCents } from "./auctionWallet";
import { demoPaymentStatus } from "./demoPaymentState";
import { isListingOwner, resolveCancellationTransition, resolveDemoWalletRefundCents } from "./bidCancellationWorkflow";

const requireUser = async (req: Request, res: Response) => {
  const user = await getAppUser(req);
  if (!user) { res.status(401).json({ ok: false, error: "Please log in to use your wallet." }); return undefined; }
  return user;
};
const pesos = (cents: number) => `₱${(cents / 100).toLocaleString("en-PH")}`;
const notifyAuctionSafely = async (...args: Parameters<typeof createNotification>) => {
  try {
    await createNotification(...args);
  } catch (error) {
    console.error("[Auctions] A committed cancellation notification could not be saved", error);
  }
};
const activeForListing = async (db: NonNullable<Awaited<ReturnType<typeof getDb>>>, listingId: string) => db.select().from(proxyBids).where(and(eq(proxyBids.listingId, listingId), eq(proxyBids.status, "active")));

async function getWalletSummary(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, userId: number) {
  const account = (await db.select({ walletCents: users.walletCents }).from(users).where(eq(users.id, userId)).limit(1))[0];
  const holdRows = await db.select({ reservedCents: proxyBids.reservedCents }).from(proxyBids).where(eq(proxyBids.userId, userId));
  const totalWalletCents = account?.walletCents ?? 0;
  const reservedCents = holdRows.reduce((sum, row) => sum + Math.max(0, row.reservedCents ?? 0), 0);
  return { walletCents: getSpendableWalletCents(totalWalletCents, reservedCents), totalWalletCents, reservedCents };
}
const auctionStatus = (row: typeof proxyBids.$inferSelect, listing: typeof listingsOwned.$inferSelect) => {
  const phase = getAuctionPhase(listing.auctionStartAt, listing.auctionEndAt);
  const bidderStatus = phase === "scheduled" ? "Auction scheduled" : row.status === "offered" ? "Second chance offered" : phase === "ended" ? row.status === "won" ? "Won" : "Lost" : row.status === "active" && row.currentBidCents > 0 ? "Winning" : "Losing";
  return { auctionState: phase === "scheduled" ? "Auction scheduled" : phase === "ended" ? "Auction ended" : "Auction ongoing", bidderStatus };
};

export async function getBidHistoryForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  await settleExpiredAuctions();
  const rows = await db.select().from(proxyBids).where(eq(proxyBids.userId, userId)).orderBy(desc(proxyBids.createdAt), desc(proxyBids.id)).limit(100);
  const cancellationRows = await db.select().from(bidCancellationRequests).where(eq(bidCancellationRequests.userId, userId));
  cancellationRows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id - a.id);
  const cancellationByBidId = new Map<number, typeof cancellationRows[number]>();
  for (const request of cancellationRows) {
    if (!cancellationByBidId.has(request.bidId)) cancellationByBidId.set(request.bidId, request);
  }
  const listingRows = await db.select().from(listingsOwned);
  const listingMap = new Map(listingRows.map((listing) => [listing.listingId, listing]));
  const orders = await db.select({ auctionBidId: commerceOrders.auctionBidId, orderId: commerceOrders.orderId, status: commerceOrders.status }).from(commerceOrders).where(eq(commerceOrders.buyerId, userId));
  const orderMap = new Map(orders.filter((order) => order.auctionBidId != null).map((order) => [order.auctionBidId!, order]));
  return rows.map((row) => {
    const listing = listingMap.get(row.listingId);
    const state = listing ? auctionStatus(row, listing) : { auctionState: "Auction ended", bidderStatus: "Lost" };
    const order = orderMap.get(row.id);
    const cancellationRequest = cancellationByBidId.get(row.id);
    return { ...row, orderId: order?.orderId ?? null, orderStatus: order?.status ?? null, cancellationRequestStatus: cancellationRequest?.status ?? null, cancellationRequestReason: cancellationRequest?.reason ?? null, winnerCancellationAllowed: listing ? Boolean(listing.winnerCancellationAllowed) : true, listingTitle: listing?.title ?? row.listingId, listingType: listing?.listingType ?? "Auction", auctionStartAt: listing?.auctionStartAt?.toISOString() ?? null, auctionEndAt: listing?.auctionEndAt?.toISOString() ?? null, ...state };
  });
}

export function registerBiddingRoutes(app: Express) {
  app.get("/api/wallet", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    return res.json({ ok: true, ...await getWalletSummary(db, user.id) });
  });
  app.post("/api/wallet/fund", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const amountCents = Math.round(Number(req.body?.amountCents));
    if (!Number.isFinite(amountCents) || amountCents < 10000 || amountCents > 100000000) return res.status(400).json({ ok: false, error: "Demo top-ups must be between ₱100 and ₱1,000,000." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    await db.update(users).set({ walletCents: sql`${users.walletCents} + ${amountCents}` }).where(eq(users.id, user.id));
    return res.json({ ok: true, ...await getWalletSummary(db, user.id) });
  });
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
    const batches = await db.select().from(auctionBidEventBatches).where(eq(auctionBidEventBatches.listingId, listingId)).orderBy(desc(auctionBidEventBatches.createdAt), desc(auctionBidEventBatches.id));
    const aliases = createBidderLabels([...rows].sort((a, b) => a.id - b.id).map((row) => row.userId), user.id);
    const bidderProfiles = isSeller && rows.length ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, [...new Set(rows.map((row) => row.userId))])) : [];
    const profileById = new Map(bidderProfiles.map((profile) => [profile.id, profile]));
    const latestOwn = rows.find((row) => row.userId === user.id);
    const leader = rows.filter((row) => row.status === "active" || row.status === "won").sort((a, b) => b.currentBidCents - a.currentBidCents || a.id - b.id)[0];
    const phase = getAuctionPhase(listing.auctionStartAt, listing.auctionEndAt);
    const ended = phase === "ended";
    const viewerBidStatus = phase === "scheduled" ? "Auction scheduled" : !latestOwn ? "You have not bid" : latestOwn.status === "won" ? "Winner" : latestOwn.status === "offered" ? "Second-chance offer" : latestOwn.status === "active" ? "Winning" : ended ? "Auction ended" : latestOwn.status === "outbid" ? "Outbid" : "Not currently bidding";
    const proxyById = new Map(rows.map((row) => [row.id, row]));
    const eventItems: Array<{ id: string; proxyBidId: number; userId: number; amountCents: number; kind: "submitted" | "automatic"; createdAt: Date; batchId: number; stepIndex: number }> = [];
    for (const batch of batches) {
      try {
        const parsed = JSON.parse(batch.eventsJson);
        if (!Array.isArray(parsed)) continue;
        parsed.forEach((event: any, stepIndex: number) => {
          if (!Number.isInteger(Number(event.proxyBidId)) || !Number.isInteger(Number(event.userId)) || !Number.isFinite(Number(event.amountCents))) return;
          eventItems.push({ id: `proxy-event-${batch.id}-${stepIndex}`, proxyBidId: Number(event.proxyBidId), userId: Number(event.userId), amountCents: Number(event.amountCents), kind: event.kind === "automatic" ? "automatic" : "submitted", createdAt: batch.createdAt, batchId: batch.id, stepIndex });
        });
      } catch { /* ignore malformed historic event batches */ }
    }
    eventItems.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.batchId - a.batchId || b.stepIndex - a.stepIndex);
    const referencedProxyIds = new Set(eventItems.map((event) => event.proxyBidId));
    const latestLeaderEventId = eventItems.find((event) => event.proxyBidId === leader?.id)?.id;
    const history = eventItems.slice(0, 300).map((event) => {
      const proxy = proxyById.get(event.proxyBidId);
      const profile = profileById.get(event.userId);
      const bidder = isSeller ? `${profile?.name || profile?.email || `Bidder ${event.userId}`} · ${aliases.get(event.userId) ?? `Bidder ${event.userId}`}` : aliases.get(event.userId) ?? "Bidder";
      const displayStatus = event.id === latestLeaderEventId ? "Winning" : proxy?.status === "cancelled" ? "Cancelled" : event.kind === "automatic" ? "Auto response" : proxy?.status === "active" ? "Bid placed" : "Outbid";
      return { id: event.id, amountCents: event.amountCents, createdAt: event.createdAt, ...(isSeller || event.userId === user.id ? { maxBidCents: proxy?.maxBidCents ?? 0 } : {}), ...(isSeller ? { userId: event.userId, maxBidCents: proxy?.maxBidCents ?? 0 } : {}), bidder, isCurrentUser: event.userId === user.id, displayStatus, method: event.kind === "automatic" ? "Automatic proxy response" : "Bid submitted", listingTitle: listing.title, cancellationReason: proxy?.cancellationReason ?? null, batchId: event.batchId, stepIndex: event.stepIndex };
    });
    const legacyRows = rows.filter((row) => !referencedProxyIds.has(row.id)).slice(0, 50);
    const legacyHistory = legacyRows.map((row) => {
      const bidder = profileById.get(row.userId);
      const { userId: bidderUserId, maxBidCents, reservedCents: _reservedCents, shippingPhone: _shippingPhone, shippingProvince: _shippingProvince, shippingMunicipality: _shippingMunicipality, shippingAddressDetails: _shippingAddressDetails, shippingLatitude: _shippingLatitude, shippingLongitude: _shippingLongitude, ...publicFields } = row;
      const displayStatus = row.status === "active" ? "Winning" : row.status === "won" ? "Winner" : row.status === "offered" ? "Second-chance offer" : row.status === "outbid" ? "Outbid" : "Resolved";
      return { ...publicFields, ...(isSeller ? { userId: bidderUserId, maxBidCents } : row.userId === user.id ? { maxBidCents } : {}), amountCents: isSeller || row.userId === user.id ? (row.currentBidCents || maxBidCents) : row.currentBidCents, bidder: isSeller ? `${bidder?.name || bidder?.email || `Bidder ${bidderUserId}`} · ${aliases.get(bidderUserId) ?? "Bidder"}` : aliases.get(bidderUserId) ?? "Bidder", isCurrentUser: row.userId === user.id, displayStatus, listingTitle: listing.title, method: row.isAutomatic ? "Automatic proxy" : "Bid submitted" };
    });
    const historyItems = [...history, ...legacyHistory].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || Number(b.batchId ?? -1) - Number(a.batchId ?? -1) || Number(b.stepIndex ?? -1) - Number(a.stepIndex ?? -1) || Number(b.id) - Number(a.id)).slice(0, 300);
    return res.json({ ok: true, listingId, viewer: isSeller ? "seller" : "buyer", viewerBidStatus, viewerBidCurrentCents: latestOwn?.currentBidCents ?? 0, viewerMaxBidCents: latestOwn?.maxBidCents ?? 0, currentBidCents: leader?.currentBidCents ?? listing.priceCents, history: historyItems });
  });
  app.get("/api/bids/my-history", async (req, res) => { const user = await requireUser(req, res); if (!user) return; return res.json({ ok: true, history: await getBidHistoryForUser(user.id) }); });
  app.get("/api/bids/stream", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const listingId = String(req.query.listingId ?? "");
    if (!listingId) return res.status(400).json({ ok: false, error: "listingId is required." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    await settleExpiredAuctions();
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    let closed = false;
    let lastSnapshot = "";
    const publish = async () => {
      if (closed) return;
      try {
        const listing = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0];
        if (!listing) return;
        const rows = await db.select().from(proxyBids).where(eq(proxyBids.listingId, listingId)).orderBy(desc(proxyBids.createdAt), desc(proxyBids.id));
        const active = rows.filter((row) => row.status === "active");
        const leader = active.sort((a, b) => b.currentBidCents - a.currentBidCents || a.id - b.id)[0];
        const own = rows.find((row) => row.userId === user.id);
        const phase = getAuctionPhase(listing.auctionStartAt, listing.auctionEndAt);
        const viewerBidStatus = phase === "scheduled" ? "Auction scheduled" : !own ? "You have not bid" : own.status === "won" ? "Winner" : own.status === "offered" ? "Second-chance offer" : own.status === "active" ? "Winning" : phase === "ended" ? "Auction ended" : own.status === "outbid" ? "Outbid" : "Not currently bidding";
        const snapshot = JSON.stringify({ listingId, latestBidId: rows[0]?.id ?? null, currentBidCents: leader?.currentBidCents ?? listing.priceCents, activeBids: active.length, phase, viewerBidStatus, viewerBidCurrentCents: own?.currentBidCents ?? 0, viewerMaxBidCents: own?.maxBidCents ?? 0, auctionStartAt: listing.auctionStartAt?.toISOString() ?? null, auctionEndAt: listing.auctionEndAt?.toISOString() ?? null, lifecycle: listing.lifecycle });
        if (snapshot === lastSnapshot) return;
        lastSnapshot = snapshot;
        res.write(`data: ${snapshot}\n\n`);
      } catch (error) { console.error("[Auctions] Failed to publish live update", error); }
    };
    const unsubscribe = subscribeAuctionUpdates(listingId, () => { void publish(); });
    await publish();
    const snapshotPoller = setInterval(() => { void publish(); }, 2500);
    const heartbeat = setInterval(() => { if (!closed) res.write(": keepalive\n\n"); }, 15000);
    req.on("close", () => { closed = true; clearInterval(snapshotPoller); clearInterval(heartbeat); unsubscribe(); });
  });
  app.get("/api/bids/current", async (req, res) => { await settleExpiredAuctions(); const listingId = String(req.query.listingId ?? ""); const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." }); const rows = await activeForListing(db, listingId); const currentBidCents = rows.reduce((highest, row) => Math.max(highest, row.currentBidCents), 0); return res.json({ ok: true, listingId, currentBidCents, hasBids: rows.length > 0 }); });
  app.get("/api/bids/summary", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    await settleExpiredAuctions();
    const listingId = String(req.query.listingId ?? "");
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const listing = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0];
    if (!listing) return res.status(404).json({ ok: false, error: "Auction listing not found." });
    if (user.role !== "admin" && listing.ownerId !== user.id) return res.status(403).json({ ok: false, error: "Only the seller can view the auction summary." });
    const rows = await db.select().from(proxyBids).where(eq(proxyBids.listingId, listingId)).orderBy(desc(proxyBids.currentBidCents), desc(proxyBids.createdAt));
    const batches = await db.select().from(auctionBidEventBatches).where(eq(auctionBidEventBatches.listingId, listingId));
    const representedProxyIds = new Set<number>();
    let eventCount = 0;
    for (const batch of batches) {
      try {
        const events = JSON.parse(batch.eventsJson);
        if (!Array.isArray(events)) continue;
        eventCount += events.length;
        for (const event of events) if (Number.isInteger(Number(event.proxyBidId))) representedProxyIds.add(Number(event.proxyBidId));
      } catch { /* ignore malformed historic event batches */ }
    }
    const legacyBidCount = rows.filter((row) => !representedProxyIds.has(row.id)).length;
    const leader = selectAuctionSummaryBid(rows);
    const leaderUser = leader ? (await db.select({ name: users.name }).from(users).where(eq(users.id, leader.userId)).limit(1))[0] : undefined;
    return res.json({ ok: true, listingId, bidCount: eventCount + legacyBidCount, activeBidCount: rows.filter((row) => row.status === "active").length, currentBidCents: leader?.currentBidCents ?? listing.priceCents, leadingBidder: leader ? { userId: leader.userId, name: leaderUser?.name ?? `Bidder ${leader.userId}`, status: leader.status, maxBidCents: leader.maxBidCents } : null });
  });
  app.get("/api/bids/proxy", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const listingId = String(req.query.listingId ?? "");
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const rows = await db.select().from(proxyBids).where(and(eq(proxyBids.userId, user.id), eq(proxyBids.listingId, listingId))).orderBy(desc(proxyBids.createdAt), desc(proxyBids.id)).limit(1);
    const latest = rows[0];
    const proxy = latest && (latest.status === "active" || latest.status === "outbid") ? latest : null;
    const all = await activeForListing(db, listingId);
    const currentBidCents = all.reduce((highest, row) => Math.max(highest, row.currentBidCents), 0);
    return res.json({ ok: true, proxy, ...(await getWalletSummary(db, user.id)), currentBidCents });
  });
  app.post("/api/bids/proxy", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const listingId = String(req.body?.listingId ?? ""); const mode = req.body?.mode === "simple" ? "simple" : "proxy"; const initialBidCents = Math.round(Number(req.body?.bidCents)); let maxBidCents = Math.round(Number(req.body?.maxBidCents)); let incrementCents = Math.round(Number(req.body?.incrementCents));
    if (!listingId || !Number.isFinite(initialBidCents) || initialBidCents <= 0 || (mode === "proxy" && (!Number.isFinite(maxBidCents) || !Number.isFinite(incrementCents) || incrementCents < 100))) return res.status(400).json({ ok: false, error: mode === "simple" ? "Enter a valid bid amount." : "Listing, max bid, and an increment of at least ₱1 are required." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const listing = (await db.select({ id: listingsOwned.id, ownerId: listingsOwned.ownerId, listingType: listingsOwned.listingType, stock: listingsOwned.stock, priceCents: listingsOwned.priceCents, auctionStartAt: listingsOwned.auctionStartAt, auctionEndAt: listingsOwned.auctionEndAt, title: listingsOwned.title, minimumIncrementCents: listingsOwned.minimumIncrementCents, antiSnipeSeconds: listingsOwned.antiSnipeSeconds, lifecycle: listingsOwned.lifecycle, winnerCancellationAllowed: listingsOwned.winnerCancellationAllowed }).from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0];
    if (!listing) return res.status(404).json({ ok: false, error: "Auction listing not found." });
    if (listing.ownerId === user.id) return res.status(403).json({ ok: false, error: "You cannot bid on your own listing." });
    if (listing.lifecycle !== "official") return res.status(409).json({ ok: false, error: "This auction is no longer active." });
    if (listing.listingType !== "Auction") return res.status(409).json({ ok: false, error: "This listing is not available for auction bidding." });
    if (listing.stock <= 0) return res.status(409).json({ ok: false, error: "This auction is out of stock and cannot accept bids." });
    const phase = getAuctionPhase(listing.auctionStartAt, listing.auctionEndAt);
    if (phase === "scheduled") return res.status(409).json({ ok: false, error: "Bidding has not started yet. Come back at the scheduled start time." });
    if (phase === "ended") return res.status(409).json({ ok: false, error: "This auction has ended." });
    const cancellationAllowed = listing.winnerCancellationAllowed !== 0;
    const delivery = req.body?.delivery ?? {};
    const phone = String(delivery.phone ?? "").trim().slice(0, 32);
    const province = String(delivery.province ?? "").trim().slice(0, 120);
    const municipality = String(delivery.municipality ?? "").trim().slice(0, 120);
    const addressDetails = String(delivery.addressDetails ?? "").trim().slice(0, 240);
    const latitude = Number(delivery.latitude); const longitude = Number(delivery.longitude);
    if (!cancellationAllowed && (req.body?.autoCheckoutConsent !== true || !/^[+0-9()\-\s]{7,32}$/.test(phone) || !province || !municipality || !addressDetails || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) return res.status(400).json({ ok: false, error: "This auction requires your explicit auto-checkout consent, phone, delivery address, and valid map pin before bidding." });
    const sellerMinimumIncrement = Math.max(100, listing.minimumIncrementCents ?? 100);
    if (mode === "proxy" && incrementCents < sellerMinimumIncrement) return res.status(400).json({ ok: false, error: `Your automatic increment must be at least the seller minimum of ${pesos(sellerMinimumIncrement)}.` });
    if (mode === "simple") { maxBidCents = initialBidCents; incrementCents = sellerMinimumIncrement; }
    if (mode === "simple" && incrementCents < sellerMinimumIncrement) return res.status(400).json({ ok: false, error: `Your bid must follow the seller minimum increment of ${pesos(sellerMinimumIncrement)}.` });
    if (maxBidCents < initialBidCents) return res.status(400).json({ ok: false, error: "Your maximum bid must be at least your opening bid." });
    if (!Number.isFinite(initialBidCents)) return res.status(400).json({ ok: false, error: "Enter a valid bid amount." });

    let extendedEnd: Date | null = null;
    const placement = await db.transaction(async (tx) => {
      const account = (await tx.select({ walletCents: users.walletCents }).from(users).where(eq(users.id, user.id)).limit(1))[0];
      if (!account) return { error: "Your wallet account could not be found.", status: 404 as const };
      const allHolds = await tx.select({ listingId: proxyBids.listingId, reservedCents: proxyBids.reservedCents }).from(proxyBids).where(eq(proxyBids.userId, user.id));
      const heldElsewhere = allHolds.filter((row) => row.listingId !== listingId).reduce((sum, row) => sum + Math.max(0, row.reservedCents ?? 0), 0);
      const heldOnThisListing = allHolds.filter((row) => row.listingId === listingId).reduce((sum, row) => sum + Math.max(0, row.reservedCents ?? 0), 0);
      const available = getSpendableWalletCents(account.walletCents, heldElsewhere);
      if (maxBidCents > available) return { error: `Your maximum bid cannot exceed your spendable e-wallet balance of ${pesos(available)}.`, status: 400 as const };
      const priorBids = await tx.select().from(proxyBids).where(eq(proxyBids.listingId, listingId));
      const currentRows = priorBids.filter((row) => row.status === "active");
      const priorCompetitor = rankCurrentProxyBids(priorBids).find((row) => row.userId !== user.id);
      const currentBidCents = currentRows.reduce((highest, row) => Math.max(highest, row.currentBidCents), listing.priceCents);
      const requiredBid = getMinimumNextBidCents(currentBidCents, listing.priceCents, sellerMinimumIncrement, currentRows.length > 0);
      if (maxBidCents < requiredBid) return { error: `Your maximum bid is below the next increment of ${pesos(requiredBid)}.`, status: 409 as const };
      if (initialBidCents < requiredBid) return { error: `Your bid must be at least ${pesos(requiredBid)}.`, status: 400 as const };
      if (heldOnThisListing > 0) await tx.update(proxyBids).set({ reservedCents: 0 }).where(and(eq(proxyBids.listingId, listingId), eq(proxyBids.userId, user.id)));
      await tx.update(proxyBids).set({ status: "outbid", currentBidCents: 0 }).where(and(eq(proxyBids.listingId, listingId), eq(proxyBids.userId, user.id), eq(proxyBids.status, "active")));
      const antiSnipeSeconds = Math.max(0, listing.antiSnipeSeconds ?? 0);
      const remainingSeconds = listing.auctionEndAt ? Math.floor((listing.auctionEndAt.getTime() - Date.now()) / 1000) : Number.MAX_SAFE_INTEGER;
      if (antiSnipeSeconds > 0 && remainingSeconds > 0 && remainingSeconds <= antiSnipeSeconds) {
        extendedEnd = new Date(listing.auctionEndAt!.getTime() + antiSnipeSeconds * 1000);
        await tx.update(listingsOwned).set({ auctionEndAt: extendedEnd, settledAt: null }).where(eq(listingsOwned.listingId, listingId));
      }
      const hold = calculateAuctionHoldChange(heldOnThisListing, maxBidCents, cancellationAllowed);
      const [created] = await tx.insert(proxyBids).values({ userId: user.id, listingId, maxBidCents, incrementCents, currentBidCents: initialBidCents, isAutomatic: mode === "proxy" ? 1 : 0, reservedCents: hold.nextHoldCents, shippingPhone: cancellationAllowed ? null : phone, shippingProvince: cancellationAllowed ? null : province, shippingMunicipality: cancellationAllowed ? null : municipality, shippingAddressDetails: cancellationAllowed ? null : addressDetails, shippingLatitude: cancellationAllowed ? null : String(latitude), shippingLongitude: cancellationAllowed ? null : String(longitude), status: "active" }).$returningId();
      const allBids = await tx.select().from(proxyBids).where(eq(proxyBids.listingId, listingId));
      const proxies = rankCurrentProxyBids(allBids);
      const winner = proxies[0]; const runner = proxies[1];
      const winningCurrent = calculateProxyWinningBidCents(winner, runner, initialBidCents, listing.priceCents, sellerMinimumIncrement);
      const proxyBidLadder = buildProxyBidLadderEvents(
        { proxyBidId: created.id, userId: user.id, maxBidCents, incrementCents },
        priorCompetitor ? { proxyBidId: priorCompetitor.id, userId: priorCompetitor.userId, maxBidCents: priorCompetitor.maxBidCents, incrementCents: priorCompetitor.incrementCents ?? sellerMinimumIncrement } : undefined,
        winner.userId,
        initialBidCents,
        winningCurrent,
        sellerMinimumIncrement,
      );
      await tx.insert(auctionBidEventBatches).values({ listingId, submittedProxyBidId: created.id, eventsJson: JSON.stringify(proxyBidLadder) });
      await tx.update(proxyBids).set({ status: "outbid", currentBidCents: 0 }).where(and(eq(proxyBids.listingId, listingId), eq(proxyBids.status, "active")));
      await tx.update(proxyBids).set({ status: "active", currentBidCents: winningCurrent }).where(eq(proxyBids.id, winner.id));
      return { createdId: created.id, proxies, winner, winningCurrent, availableBefore: available };
    });
    if ("error" in placement) return res.status(placement.status ?? 200).json({ ok: false, error: placement.error, ...(placement.status === 409 ? { limitReached: true } : {}) });
    if (extendedEnd) await createNotification(listing.ownerId, "system", "Auction extended", `A last-second bid extended “${listing.title}” by ${Math.max(0, listing.antiSnipeSeconds ?? 0)} seconds.`, listingId);
    for (const proxy of placement.proxies) {
      if (proxy.id === placement.winner.id) await createNotification(proxy.userId, "system", "You are winning", `You are currently leading “${listing.title}” at ${pesos(placement.winningCurrent)}. Your current bid cap is ${pesos(proxy.maxBidCents)}.`, listingId);
      else await createNotification(proxy.userId, "system", "You were outbid", `Your bid on “${listing.title}” is losing at ${pesos(placement.winningCurrent)}. Increase your maximum bid to continue.`, listingId);
    }
    const row = (await db.select().from(proxyBids).where(eq(proxyBids.id, placement.createdId)).limit(1))[0];
    const balance = await getWalletSummary(db, user.id);
    publishAuctionUpdate(listingId);
    return res.json({ ok: true, proxy: row, walletCents: balance.walletCents, reservedCents: balance.reservedCents, currentBidCents: placement.winningCurrent, leadingUserId: placement.winner.userId });
  });
  app.post("/api/bids/:bidId/checkout", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    await settleExpiredAuctions();
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const bidId = Number(req.params.bidId);
    const phone = String(req.body?.phone ?? "").trim().slice(0, 32); const province = String(req.body?.province ?? "").trim().slice(0, 120); const municipality = String(req.body?.municipality ?? "").trim().slice(0, 120); const addressDetails = String(req.body?.addressDetails ?? "").trim().slice(0, 240); const payment = req.body?.payment === "COD" ? "COD" as const : "E-wallet" as const;
    const latitude = req.body?.latitude == null ? null : Number(req.body.latitude); const longitude = req.body?.longitude == null ? null : Number(req.body.longitude);
    if (!/^[+0-9()\-\s]{7,32}$/.test(phone) || !province || !municipality || !addressDetails || ((latitude == null) !== (longitude == null)) || (latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) || (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) return res.status(400).json({ ok: false, error: "Enter a valid phone number, delivery address, province, and municipality; map coordinates must be valid when supplied." });
    const result = await db.transaction(async (tx) => {
      const bid = (await tx.select().from(proxyBids).where(and(eq(proxyBids.id, bidId), eq(proxyBids.userId, user.id))).limit(1))[0];
      if (!bid || bid.status !== "won") return { error: "Only your winning auction can be checked out.", status: 409 as const };
      const listing = (await tx.select().from(listingsOwned).where(eq(listingsOwned.listingId, bid.listingId)).limit(1))[0];
      if (!listing || listing.lifecycle !== "sold") return { error: "This auction is no longer awaiting checkout.", status: 409 as const };
      if (listing.winnerCancellationAllowed === 0) return { error: "This auction automatically created the winner’s order; open the order receipt instead.", status: 409 as const };
      const existing = (await tx.select({ orderId: commerceOrders.orderId }).from(commerceOrders).where(eq(commerceOrders.auctionBidId, bid.id)).limit(1))[0];
      if (existing) { await tx.update(proxyBids).set({ acceptanceDeadline: null }).where(eq(proxyBids.id, bid.id)); return { orderId: existing.orderId, amountCents: bid.currentBidCents || bid.maxBidCents, sellerId: listing.ownerId, listingTitle: listing.title, existing: true }; }
      const amountCents = bid.currentBidCents || bid.maxBidCents;
      const auctionSize = (await tx.select().from(listingSizeVariants).where(eq(listingSizeVariants.listingId, listing.listingId)).limit(1))[0];
      if (payment === "E-wallet") {
        const account = (await tx.select({ walletCents: users.walletCents }).from(users).where(eq(users.id, user.id)).limit(1))[0];
        const holds = await tx.select({ reservedCents: proxyBids.reservedCents }).from(proxyBids).where(eq(proxyBids.userId, user.id));
        const heldElsewhere = holds.reduce((sum, row) => sum + Math.max(0, row.reservedCents ?? 0), 0);
        if (!account || account.walletCents < amountCents + heldElsewhere) return { error: `Available wallet funds after active auction holds are not enough. Add ${pesos(amountCents)} or choose Cash on Delivery.`, status: 400 as const };
        const debited = await tx.update(users).set({ walletCents: sql`${users.walletCents} - ${amountCents}` }).where(and(eq(users.id, user.id), gte(users.walletCents, amountCents + heldElsewhere)));
        if (debited[0]?.affectedRows === 0) return { error: "Wallet balance changed during checkout. Refresh and try again.", status: 409 as const };
      }
      const orderId = `MH-AUC-${bid.id}-${Date.now()}`;
      await tx.insert(commerceOrders).values({ orderId, listingId: listing.listingId, auctionBidId: bid.id, buyerId: user.id, sellerId: listing.ownerId, quantity: 1, variantSize: auctionSize?.size ?? null, variantColor: auctionSize?.color || null, unitPriceCents: amountCents, amountCents, payment, province, municipality, addressDetails, contactNumber: phone, destinationLatitude: latitude == null ? null : String(latitude), destinationLongitude: longitude == null ? null : String(longitude), status: "Processing" });
      const paymentMethod = payment === "COD" ? "cod" as const : "demo_wallet" as const;
      await tx.insert(paymentOrders).values({ orderId, paymentMethod, stripeCheckoutSessionId: null, stripePaymentIntentId: null, currency: "PHP", amountMinor: amountCents, customerEmail: String(user.email ?? "").slice(0, 320), customerName: String(user.name || user.email || "Buyer").slice(0, 120), itemTitle: listing.title.slice(0, 160), status: demoPaymentStatus(paymentMethod, "Processing") });
      await tx.update(proxyBids).set({ acceptanceDeadline: null }).where(eq(proxyBids.id, bid.id));
      return { orderId, amountCents, sellerId: listing.ownerId, listingTitle: listing.title, existing: false };
    });
    if ("error" in result) return res.status(result.status ?? 200).json({ ok: false, error: result.error });
    if (!result.existing) {
      await createNotification(user.id, "order_created", "Auction order placed", `Your order ${result.orderId} for “${result.listingTitle}” is confirmed at ${pesos(result.amountCents)}.`, result.orderId);
      await createNotification(result.sellerId, "order_created", "Auction sale checkout completed", `The winner completed checkout for “${result.listingTitle}”. Order ${result.orderId} is ready for fulfillment.`, result.orderId);
    }
    return res.status(result.existing ? 200 : 201).json({ ok: true, orderId: result.orderId, amountCents: result.amountCents, existing: result.existing });
  });
  app.post("/api/bids/:bidId/cancel", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const reason = String(req.body?.reason ?? "").trim().slice(0, 500);
    if (!reason) return res.status(400).json({ ok: false, error: "Please provide a reason for asking to cancel the winning item." });
    await settleExpiredAuctions();
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    let result: any;
    try {
      result = await db.transaction(async (tx) => {
        const bid = (await tx.select().from(proxyBids).where(and(eq(proxyBids.id, Number(req.params.bidId)), eq(proxyBids.userId, user.id))).limit(1).for("update"))[0];
        if (!bid || bid.status !== "won") return { error: "Only your won auction can be submitted for cancellation.", status: 404 as const };
        const listing = (await tx.select().from(listingsOwned).where(eq(listingsOwned.listingId, bid.listingId)).limit(1))[0];
        if (!listing) return { error: "Auction listing not found.", status: 404 as const };
        const existing = (await tx.select().from(bidCancellationRequests).where(and(eq(bidCancellationRequests.bidId, bid.id), eq(bidCancellationRequests.status, "pending"))).limit(1))[0];
        if (existing) return { request: existing, listing, existing: true };
        const order = (await tx.select().from(commerceOrders).where(eq(commerceOrders.auctionBidId, bid.id)).limit(1))[0];
        const eligibility = resolveWinnerCancellation(Boolean(listing.winnerCancellationAllowed), order?.status ?? null, null, 0);
        if (!eligibility.allowed) return { error: eligibility.reason === "seller-policy" ? "This seller does not allow change-of-mind cancellation after winning." : "Cancellation requests are only available before delivery starts. Contact the seller if there is a fulfillment issue.", status: 409 as const };
        const inserted = await tx.insert(bidCancellationRequests).values({ bidId: bid.id, listingId: bid.listingId, userId: user.id, reason }).$returningId();
        const request = (await tx.select().from(bidCancellationRequests).where(eq(bidCancellationRequests.id, inserted[0].id)).limit(1))[0];
        return { request, listing, existing: false };
      });
    } catch (error) {
      console.error("[Auctions] Winner cancellation request failed", error);
      return res.status(500).json({ ok: false, error: "Cancellation request could not be saved." });
    }
    if ("error" in result) return res.status(result.status ?? 200).json({ ok: false, error: result.error });
    if (!result.existing) await notifyAuctionSafely(result.listing.ownerId, "system", "Bid cancellation request", `The winning buyer asked to cancel “${result.listing.title}”: ${reason}. The bid and order remain unchanged until you approve or deny the request.`, result.listing.listingId);
    return res.status(result.existing ? 200 : 201).json({ ok: true, request: result.request, existing: result.existing, status: "pending" });
  });
  app.post("/api/bids/:bidId/cancellation-request", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const reason = String(req.body?.reason ?? "").trim().slice(0, 500);
    if (!reason) return res.status(400).json({ ok: false, error: "A cancellation reason is required." });
    const db = await getDb();
    if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });

    let result: any;
    try {
      result = await db.transaction(async (tx) => {
        const bid = (await tx.select().from(proxyBids)
          .where(and(eq(proxyBids.id, Number(req.params.bidId)), eq(proxyBids.userId, user.id)))
          .limit(1).for("update"))[0];
        if (!bid || bid.status !== "active") return { error: "Only an active bid can be submitted for cancellation." };

        const existing = (await tx.select().from(bidCancellationRequests)
          .where(and(eq(bidCancellationRequests.bidId, bid.id), eq(bidCancellationRequests.status, "pending")))
          .limit(1))[0];
        if (existing) return { request: existing, existing: true };

        const listing = (await tx.select().from(listingsOwned).where(eq(listingsOwned.listingId, bid.listingId)).limit(1))[0];
        if (!listing) return { error: "Auction listing not found." };
        const inserted = await tx.insert(bidCancellationRequests).values({ bidId: bid.id, listingId: bid.listingId, userId: user.id, reason }).$returningId();
        const request = (await tx.select().from(bidCancellationRequests).where(eq(bidCancellationRequests.id, inserted[0].id)).limit(1))[0];
        return { request, listing, existing: false };
      });
    } catch (error) {
      console.error("[Auctions] Active-bid cancellation request failed", error);
      return res.status(500).json({ ok: false, error: "Cancellation request could not be saved." });
    }
    if ("error" in result) return res.status(result.error === "Auction listing not found." ? 404 : 409).json({ ok: false, error: result.error });
    if (!result.existing) {
      try {
        await createNotification(result.listing.ownerId, "system", "Bid cancellation request", `A buyer requested cancellation for “${result.listing.title}”: ${reason}. The bid remains unchanged until you approve or deny the request.`, result.listing.listingId);
      } catch (error) {
        console.error("[Auctions] Cancellation notification could not be saved", error);
      }
    }
    return res.status(result.existing ? 200 : 201).json({ ok: true, request: result.request, existing: result.existing });
  });
  app.get("/api/bids/cancellation-requests", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const db = await getDb();
    if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const isAdmin = user.role === "admin" && user.email.toLowerCase() === "admin@gmail.com";
    const rows = await db.select().from(bidCancellationRequests).orderBy(desc(bidCancellationRequests.createdAt));
    const ownedListings = isAdmin ? [] : await db.select({ listingId: listingsOwned.listingId }).from(listingsOwned).where(eq(listingsOwned.ownerId, user.id));
    const ownedListingIds = new Set(ownedListings.map((listing) => listing.listingId));
    const visibleRows = isAdmin ? rows : rows.filter((request) => request.userId === user.id || ownedListingIds.has(request.listingId));
    const requests = await Promise.all(visibleRows.map(async (request) => {
      const [bid, listing, bidder] = await Promise.all([
        db.select().from(proxyBids).where(eq(proxyBids.id, request.bidId)).limit(1),
        db.select({ title: listingsOwned.title, ownerId: listingsOwned.ownerId }).from(listingsOwned).where(eq(listingsOwned.listingId, request.listingId)).limit(1),
        db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, request.userId)).limit(1),
      ]);
      const order = await db.select({ orderId: commerceOrders.orderId, status: commerceOrders.status, payment: commerceOrders.payment }).from(commerceOrders).where(eq(commerceOrders.auctionBidId, request.bidId)).limit(1);
      const ledger = order[0] ? await db.select({ paymentMethod: paymentOrders.paymentMethod, status: paymentOrders.status, amountMinor: paymentOrders.amountMinor, currency: paymentOrders.currency }).from(paymentOrders).where(eq(paymentOrders.orderId, order[0].orderId)).limit(1) : [];
      return {
        ...request,
        listingTitle: listing[0]?.title ?? request.listingId,
        bidderName: bidder[0]?.name || bidder[0]?.email || `User ${request.userId}`,
        bidderEmail: bidder[0]?.email ?? "",
        bidAmountCents: bid[0]?.currentBidCents ?? bid[0]?.maxBidCents ?? null,
        bidStatus: bid[0]?.status ?? "missing",
        orderStatus: order[0]?.status ?? null,
        orderPayment: order[0]?.payment ?? null,
        paymentMethod: ledger[0]?.paymentMethod ?? null,
        paymentStatus: ledger[0]?.status ?? null,
        paymentAmountMinor: ledger[0]?.amountMinor ?? null,
        paymentCurrency: ledger[0]?.currency ?? null,
        canDecide: listing[0]?.ownerId === user.id,
      };
    }));
    return res.json({ ok: true, requests });
  });
  app.patch("/api/bids/cancellation-requests/:requestId", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const status = req.body?.status === "approved" ? "approved" : req.body?.status === "denied" ? "denied" : null;
    if (!status) return res.status(400).json({ ok: false, error: "Status must be approved or denied." });
    const requestId = Number(req.params.requestId);
    const db = await getDb();
    if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    await settleExpiredAuctions();
    let result: any;
    try {
      result = await db.transaction(async (tx) => {
        const request = (await tx.select().from(bidCancellationRequests).where(eq(bidCancellationRequests.id, requestId)).limit(1).for("update"))[0];
        if (!request) throw new Error("REQUEST_NOT_FOUND");
        if (request.status !== "pending") throw new Error("REQUEST_ALREADY_DECIDED");
        const listing = (await tx.select().from(listingsOwned).where(eq(listingsOwned.listingId, request.listingId)).limit(1))[0];
        if (!listing || !isListingOwner(listing.ownerId, user.id)) throw new Error("SELLER_NOT_AUTHORIZED");
        const bid = (await tx.select().from(proxyBids).where(eq(proxyBids.id, request.bidId)).limit(1).for("update"))[0];
        const transition = resolveCancellationTransition(request.status, bid?.status ?? null, status);
        if ("error" in transition) throw new Error(transition.error);

        let winnerOutcome: any = null;
        if (status === "approved" && bid?.status === "active") {
          const cancelled = await tx.update(proxyBids).set({ status: "cancelled", currentBidCents: 0, reservedCents: 0, cancellationReason: request.reason }).where(and(eq(proxyBids.id, request.bidId), eq(proxyBids.status, "active")));
          if (cancelled[0]?.affectedRows === 0) throw new Error("BID_NO_LONGER_ACTIVE");
        } else if (status === "approved" && bid?.status === "won") {
          const order = (await tx.select().from(commerceOrders).where(eq(commerceOrders.auctionBidId, bid.id)).limit(1))[0];
          const cancellation = resolveWinnerCancellation(Boolean(listing.winnerCancellationAllowed), order?.status ?? null, null, 0);
          if (!cancellation.allowed) throw new Error(cancellation.reason === "seller-policy" ? "WINNER_CANCELLATION_POLICY" : "WINNER_ORDER_ADVANCED");

          const restored = await tx.update(listingsOwned).set({ lifecycle: "canceled", stock: listing.stock + 1 }).where(and(eq(listingsOwned.listingId, listing.listingId), eq(listingsOwned.lifecycle, "sold")));
          if (restored[0]?.affectedRows === 0) throw new Error("LISTING_NO_LONGER_SOLD");
          const auctionSizeRows = await tx.select().from(listingSizeVariants).where(eq(listingSizeVariants.listingId, listing.listingId));
          if (auctionSizeRows.length) await tx.update(listingSizeVariants).set({ stock: sql`${listingSizeVariants.stock} + 1` }).where(eq(listingSizeVariants.id, auctionSizeRows[0].id));
          const cancelled = await tx.update(proxyBids).set({ status: "cancelled", currentBidCents: 0, reservedCents: 0, cancellationReason: request.reason }).where(and(eq(proxyBids.id, bid.id), eq(proxyBids.status, "won")));
          if (cancelled[0]?.affectedRows === 0) throw new Error("BID_NO_LONGER_ACTIVE");
          let refundedCents = 0;
          let paymentNote = order ? "No eligible paid demo-wallet payment was confirmed in the order ledger, so no wallet refund was issued." : "There was no checkout order to refund.";
          if (order) {
            const orderCancelled = await tx.update(commerceOrders).set({ status: "Cancelled" }).where(and(eq(commerceOrders.id, order.id), eq(commerceOrders.status, "Processing")));
            if (orderCancelled[0]?.affectedRows === 0) throw new Error("WINNER_ORDER_ADVANCED");
            const paymentLedger = (await tx.select().from(paymentOrders).where(eq(paymentOrders.orderId, order.orderId)).limit(1))[0];
            if (!paymentLedger) {
              paymentNote = "No payment ledger record was found for this order, so no wallet refund was issued.";
            } else if (order.payment === "E-wallet" && paymentLedger.paymentMethod === "demo_wallet" && paymentLedger.currency === "PHP" && paymentLedger.status !== "cancelled") {
              const ledgerRefundCents = resolveDemoWalletRefundCents(order.payment, paymentLedger.paymentMethod, paymentLedger.status, paymentLedger.amountMinor, paymentLedger.currency);
              const ledgerCancelled = await tx.update(paymentOrders).set({ status: "cancelled" }).where(and(eq(paymentOrders.orderId, order.orderId), eq(paymentOrders.paymentMethod, "demo_wallet"), eq(paymentOrders.currency, "PHP"), eq(paymentOrders.status, paymentLedger.status)));
              if (ledgerCancelled[0]?.affectedRows) {
                refundedCents = ledgerRefundCents;
                if (refundedCents > 0) await tx.update(users).set({ walletCents: sql`${users.walletCents} + ${refundedCents}` }).where(eq(users.id, request.userId));
                paymentNote = refundedCents > 0 ? `The demo-wallet payment of ${pesos(refundedCents)} was returned.` : "The demo-wallet ledger contained no positive eligible amount, so no refund was issued.";
              } else {
                paymentNote = "The payment status changed during seller approval; no additional refund was issued.";
              }
            } else if (order.payment === "COD" && paymentLedger.paymentMethod === "cod" && paymentLedger.status === "pending") {
              const codCancelled = await tx.update(paymentOrders).set({ status: "cancelled" }).where(and(eq(paymentOrders.orderId, order.orderId), eq(paymentOrders.paymentMethod, "cod"), eq(paymentOrders.status, "pending")));
              paymentNote = codCancelled[0]?.affectedRows ? "The cash-on-delivery payment was still pending, so no refund was needed." : "The COD payment status changed during seller approval; no refund was issued.";
            }
          }
          const bids = await tx.select().from(proxyBids).where(eq(proxyBids.listingId, listing.listingId)).orderBy(desc(proxyBids.createdAt));
          const runner = selectSecondChanceBid(bids, request.userId);
          let offerSent = false;
          if (runner) {
            const offered = await tx.update(proxyBids).set({ status: "offered", currentBidCents: runner.maxBidCents, reservedCents: 0, acceptanceDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000) }).where(and(eq(proxyBids.id, runner.id), eq(proxyBids.status, "outbid")));
            offerSent = offered[0]?.affectedRows !== 0;
          }
          winnerOutcome = { listingId: listing.listingId, listingTitle: listing.title, sellerId: listing.ownerId, buyerId: request.userId, reason: request.reason, runner: offerSent ? runner : null, offerSent, refundedCents, paymentNote, orderId: order?.orderId ?? null };
        }

        const updated = await tx.update(bidCancellationRequests).set({ status }).where(and(eq(bidCancellationRequests.id, request.id), eq(bidCancellationRequests.status, "pending")));
        if (updated[0]?.affectedRows === 0) throw new Error("REQUEST_ALREADY_DECIDED");
        return { request, listingTitle: listing.title, winnerOutcome, bidStatus: bid?.status ?? "missing" };
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "REQUEST_NOT_FOUND") return res.status(404).json({ ok: false, error: "Cancellation request not found." });
      if (code === "REQUEST_ALREADY_DECIDED") return res.status(409).json({ ok: false, error: "This cancellation request was already decided." });
      if (code === "BID_NO_LONGER_ACTIVE") return res.status(409).json({ ok: false, error: "This bid is no longer eligible for cancellation from this request." });
      if (code === "SELLER_NOT_AUTHORIZED") return res.status(403).json({ ok: false, error: "Only the seller who owns this listing can decide its bid cancellation requests." });
      if (code === "WINNER_CANCELLATION_POLICY") return res.status(409).json({ ok: false, error: "The seller's cancellation policy no longer allows this winner cancellation." });
      if (code === "WINNER_ORDER_ADVANCED") return res.status(409).json({ ok: false, error: "The order has entered delivery or changed status, so it cannot be cancelled through this request." });
      if (code === "LISTING_NO_LONGER_SOLD") return res.status(409).json({ ok: false, error: "The listing is no longer eligible for winner cancellation." });
      console.error("[Auctions] Seller cancellation decision failed", error);
      return res.status(500).json({ ok: false, error: "The seller decision could not be saved. No cancellation or refund was saved." });
    }

    const outcome = result.winnerOutcome;
    if (outcome) {
      const refundText = ` ${outcome.paymentNote}`;
      const offerText = outcome.offerSent ? " A second-chance offer is now waiting for the next-highest bidder." : " There was no eligible second-highest bidder; the seller can re-auction the item.";
      await notifyAuctionSafely(outcome.buyerId, "system", "Bid cancellation approved", `The seller approved your request to cancel “${outcome.listingTitle}”.${refundText}${offerText}`, outcome.listingId);
      if (outcome.offerSent && outcome.runner) {
        await notifyAuctionSafely(outcome.runner.userId, "system", "Second-chance offer", `The winning buyer's cancellation was approved for “${outcome.listingTitle}”. You were the next-highest bidder, so the item is offered to you at ${pesos(outcome.runner.maxBidCents)}. Accept or decline this offer from your notification.`, outcome.listingId);
        await notifyAuctionSafely(outcome.sellerId, "system", "Cancellation approved — second chance offered", `You approved the winning buyer's cancellation for “${outcome.listingTitle}”. A second-chance offer was sent to the next-highest bidder. Reason: ${outcome.reason}.`, outcome.orderId ?? outcome.listingId);
      } else {
        await notifyAuctionSafely(outcome.sellerId, "system", "Winner cancellation approved", `You approved the winning buyer's cancellation for “${outcome.listingTitle}”. No eligible second-highest bidder remains. Reason: ${outcome.reason}. The listing is available to re-auction.`, outcome.orderId ?? outcome.listingId);
      }
    } else {
      const decisionMessage = status === "approved"
        ? `The seller approved your request to cancel your bid on “${result.listingTitle}”. Your bid is now cancelled.`
        : `The seller denied your request to cancel your bid on “${result.listingTitle}”. ${result.bidStatus === "won" ? "Your winning bid and order remain unchanged." : result.bidStatus === "active" ? "Your bid remains active." : "The bid’s status had already changed."}`;
      await notifyAuctionSafely(result.request.userId, "system", `Bid cancellation ${status}`, decisionMessage, result.request.listingId);
    }
    if (status === "approved") publishAuctionUpdate(result.request.listingId);
    return res.json({ ok: true, status, secondChanceUserId: outcome?.runner?.userId ?? null, offerSent: outcome?.offerSent ?? false, refundedCents: outcome?.refundedCents ?? 0, paymentNote: outcome?.paymentNote ?? null });
  });
  app.get("/api/bids/second-chance/offers", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    await settleExpiredAuctions();
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const offeredBids = await db.select().from(proxyBids).where(and(eq(proxyBids.userId, user.id), eq(proxyBids.status, "offered"))).orderBy(desc(proxyBids.createdAt));
    const offers = await Promise.all(offeredBids.map(async (bid) => {
      const listing = (await db.select({ title: listingsOwned.title, category: listingsOwned.category }).from(listingsOwned).where(eq(listingsOwned.listingId, bid.listingId)).limit(1))[0];
      return { bidId: bid.id, listingId: bid.listingId, amountCents: bid.currentBidCents, title: listing?.title ?? bid.listingId, category: listing?.category ?? "Auction", acceptanceDeadline: bid.acceptanceDeadline };
    }));
    return res.json({ ok: true, offers });
  });
  app.post("/api/bids/second-chance/accept", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const listingId = String(req.body?.listingId ?? "");
    await settleExpiredAuctions();
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    let decision: any;
    try {
      decision = await db.transaction(async (tx) => {
        const runner = (await tx.select().from(proxyBids).where(and(eq(proxyBids.listingId, listingId), eq(proxyBids.userId, user.id), eq(proxyBids.status, "offered"))).orderBy(desc(proxyBids.createdAt)).limit(1))[0];
        if (!runner) return { error: "No second-chance offer is available for this account.", status: 404 as const };
        const listing = (await tx.select().from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0];
        if (!listing || !["auction-ended", "canceled"].includes(listing.lifecycle) || listing.stock <= 0) return { error: "This second-chance offer is no longer available.", status: 409 as const };
        if (listing.winnerCancellationAllowed === 0) return { error: "This auction does not allow change-of-mind cancellation, so the second-chance offer is not available.", status: 409 as const };
        const amountCents = runner.currentBidCents || runner.maxBidCents;
        const auctionSizeRows = await tx.select().from(listingSizeVariants).where(eq(listingSizeVariants.listingId, listingId));
        if (auctionSizeRows.length && auctionSizeRows[0].stock <= 0) return { error: "The auction size is no longer in stock.", status: 409 as const };
        const bidChanged = await tx.update(proxyBids).set({ status: "won", currentBidCents: amountCents }).where(and(eq(proxyBids.id, runner.id), eq(proxyBids.status, "offered"), eq(proxyBids.userId, user.id)));
        if (bidChanged[0]?.affectedRows === 0) return { error: "This offer has already been answered.", status: 409 as const };
        const listingChanged = await tx.update(listingsOwned).set({ lifecycle: "sold", stock: listing.stock - 1 }).where(and(eq(listingsOwned.listingId, listingId), inArray(listingsOwned.lifecycle, ["auction-ended", "canceled"]), eq(listingsOwned.stock, listing.stock)));
        if (listingChanged[0]?.affectedRows === 0) throw new Error("SECOND_CHANCE_LISTING_CLAIMED");
        if (auctionSizeRows.length) {
          const sizeMoved = await tx.update(listingSizeVariants).set({ stock: sql`${listingSizeVariants.stock} - 1` }).where(and(eq(listingSizeVariants.id, auctionSizeRows[0].id), gte(listingSizeVariants.stock, 1)));
          if (sizeMoved[0]?.affectedRows === 0) throw new Error("SECOND_CHANCE_LISTING_CLAIMED");
        }
        return { listing, amountCents };
      });
    } catch (error) {
      if (error instanceof Error && error.message === "SECOND_CHANCE_LISTING_CLAIMED") return res.status(409).json({ ok: false, error: "This offer has already been resolved. Refresh and check your notifications." });
      console.error("[Auctions] Second-chance acceptance transaction failed", error);
      return res.status(500).json({ ok: false, error: "The offer could not be accepted. No bid or inventory change was saved." });
    }
    if ("error" in decision) return res.status(decision.status).json({ ok: false, error: decision.error });
    await createNotification(decision.listing.ownerId, "auction_won", "Second-chance offer accepted", `The next-highest bidder accepted “${decision.listing.title}” at ${pesos(decision.amountCents)}.`, listingId);
    await createNotification(user.id, "auction_won", "You are the winner of this item", `You accepted “${decision.listing.title}” at ${pesos(decision.amountCents)}. Open your auction detail to review the item, seller, and winning amount.`, listingId);
    publishAuctionUpdate(listingId);
    return res.json({ ok: true, listingId, status: "won" });
  });
  app.post("/api/bids/second-chance/decline", async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const listingId = String(req.body?.listingId ?? "");
    await settleExpiredAuctions();
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const decision = await db.transaction(async (tx) => {
      const runner = (await tx.select().from(proxyBids).where(and(eq(proxyBids.listingId, listingId), eq(proxyBids.userId, user.id), eq(proxyBids.status, "offered"))).orderBy(desc(proxyBids.createdAt)).limit(1))[0];
      if (!runner) return { error: "No second-chance offer is available for this account.", status: 404 as const };
      const listing = (await tx.select().from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0];
      if (!listing || !["auction-ended", "canceled"].includes(listing.lifecycle)) return { error: "This second-chance offer is no longer available.", status: 409 as const };
      const transition = secondChanceTransition("decline");
      const changed = await tx.update(proxyBids).set({ status: transition.bidStatus, currentBidCents: 0, reservedCents: 0, acceptanceDeadline: null, cancellationReason: "The second-chance offer was declined by the bidder." }).where(and(eq(proxyBids.id, runner.id), eq(proxyBids.status, "offered"), eq(proxyBids.userId, user.id)));
      if (changed[0]?.affectedRows === 0) return { error: "This offer has already been answered.", status: 409 as const };
      await tx.update(listingsOwned).set({ lifecycle: transition.listingLifecycle }).where(and(eq(listingsOwned.listingId, listingId), inArray(listingsOwned.lifecycle, ["auction-ended", "canceled"])));
      return { listing };
    });
    if ("error" in decision) return res.status(decision.status ?? 409).json({ ok: false, error: decision.error });
    await createNotification(decision.listing.ownerId, "system", "Second-chance offer declined", `The next-highest bidder declined “${decision.listing.title}”. The auction is in Inventory → Auction ended and can be re-auctioned.`, listingId);
    await createNotification(user.id, "system", "Second-chance offer declined", `You declined the offer for “${decision.listing.title}”.`, listingId);
    publishAuctionUpdate(listingId);
    return res.json({ ok: true, listingId, status: "declined" });
  });
}
