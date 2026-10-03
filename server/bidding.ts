import type { Express, Request, Response } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "./db";
import { bidCancellationRequests, commerceOrders, listingsOwned, proxyBids, users } from "../drizzle/schema";
import { getAppUser } from "./appAuth";
import { createNotification, settleExpiredAuctions } from "./notifications";
import { calculateProxyWinningBidCents, createBidderLabels, getAuctionPhase, rankCurrentProxyBids, selectAuctionSummaryBid, selectSecondChanceBid, secondChanceTransition } from "./auctionState";
import { publishAuctionUpdate, subscribeAuctionUpdates } from "./auctionEvents";
import { calculateAuctionHoldChange, getSpendableWalletCents } from "./auctionWallet";

const requireUser = async (req: Request, res: Response) => {
  const user = await getAppUser(req);
  if (!user) { res.status(401).json({ ok: false, error: "Please log in to use your wallet." }); return undefined; }
  return user;
};
const pesos = (cents: number) => `₱${(cents / 100).toLocaleString("en-PH")}`;
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
  const listingRows = await db.select().from(listingsOwned);
  const listingMap = new Map(listingRows.map((listing) => [listing.listingId, listing]));
  const orders = await db.select({ auctionBidId: commerceOrders.auctionBidId, orderId: commerceOrders.orderId, status: commerceOrders.status }).from(commerceOrders).where(eq(commerceOrders.buyerId, userId));
  const orderMap = new Map(orders.filter((order) => order.auctionBidId != null).map((order) => [order.auctionBidId!, order]));
  return rows.map((row) => {
    const listing = listingMap.get(row.listingId);
    const state = listing ? auctionStatus(row, listing) : { auctionState: "Auction ended", bidderStatus: "Lost" };
    const order = orderMap.get(row.id);
    return { ...row, orderId: order?.orderId ?? null, orderStatus: order?.status ?? null, winnerCancellationAllowed: listing ? Boolean(listing.winnerCancellationAllowed) : true, listingTitle: listing?.title ?? row.listingId, listingType: listing?.listingType ?? "Auction", auctionStartAt: listing?.auctionStartAt?.toISOString() ?? null, auctionEndAt: listing?.auctionEndAt?.toISOString() ?? null, ...state };
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
    const aliases = createBidderLabels([...rows].sort((a, b) => a.id - b.id).map((row) => row.userId), user.id);
    const latestOwn = rows.find((row) => row.userId === user.id);
    const leader = rows.filter((row) => row.status === "active").sort((a, b) => b.currentBidCents - a.currentBidCents || a.id - b.id)[0];
    const phase = getAuctionPhase(listing.auctionStartAt, listing.auctionEndAt);
    const ended = phase === "ended";
    const viewerBidStatus = phase === "scheduled" ? "Auction scheduled" : !latestOwn ? "You have not bid" : latestOwn.status === "won" ? "Winner" : latestOwn.status === "offered" ? "Second-chance offer" : latestOwn.status === "active" ? "Winning" : ended ? "Auction ended" : latestOwn.status === "outbid" ? "Outbid" : "Not currently bidding";
    const visibleRows = rows.slice(0, 50);
    const history = await Promise.all(visibleRows.map(async (row) => {
      const bidder = isSeller ? (await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, row.userId)).limit(1))[0] : undefined;
      const { userId: bidderUserId, maxBidCents, reservedCents: _reservedCents, shippingPhone: _shippingPhone, shippingProvince: _shippingProvince, shippingMunicipality: _shippingMunicipality, shippingAddressDetails: _shippingAddressDetails, shippingLatitude: _shippingLatitude, shippingLongitude: _shippingLongitude, ...publicFields } = row;
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
  app.get("/api/bids/summary", async (req, res) => { const user = await requireUser(req, res); if (!user) return; await settleExpiredAuctions(); const listingId = String(req.query.listingId ?? ""); const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." }); const listing = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0]; if (!listing) return res.status(404).json({ ok: false, error: "Auction listing not found." }); if (user.role !== "admin" && listing.ownerId !== user.id) return res.status(403).json({ ok: false, error: "Only the seller can view the auction summary." }); const rows = await db.select().from(proxyBids).where(eq(proxyBids.listingId, listingId)).orderBy(desc(proxyBids.currentBidCents), desc(proxyBids.createdAt)); const leader = selectAuctionSummaryBid(rows); const leaderUser = leader ? (await db.select({ name: users.name }).from(users).where(eq(users.id, leader.userId)).limit(1))[0] : undefined; return res.json({ ok: true, listingId, bidCount: rows.length, activeBidCount: rows.filter((row) => row.status === "active").length, currentBidCents: leader?.currentBidCents ?? listing.priceCents, leadingBidder: leader ? { userId: leader.userId, name: leaderUser?.name ?? `Bidder ${leader.userId}`, status: leader.status, maxBidCents: leader.maxBidCents } : null }); });
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
    if (listing.listingType !== "Auction" && listing.listingType !== "Both") return res.status(409).json({ ok: false, error: "This listing is not available for auction bidding." });
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
      const currentRows = await tx.select().from(proxyBids).where(and(eq(proxyBids.listingId, listingId), eq(proxyBids.status, "active")));
      const currentBidCents = currentRows.reduce((highest, row) => Math.max(highest, row.currentBidCents), listing.priceCents);
      const requiredBid = currentRows.length ? currentBidCents + sellerMinimumIncrement : listing.priceCents;
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
      if (existing) return { orderId: existing.orderId, amountCents: bid.currentBidCents || bid.maxBidCents, sellerId: listing.ownerId, listingTitle: listing.title, existing: true };
      const amountCents = bid.currentBidCents || bid.maxBidCents;
      if (payment === "E-wallet") {
        const account = (await tx.select({ walletCents: users.walletCents }).from(users).where(eq(users.id, user.id)).limit(1))[0];
        const holds = await tx.select({ reservedCents: proxyBids.reservedCents }).from(proxyBids).where(eq(proxyBids.userId, user.id));
        const heldElsewhere = holds.reduce((sum, row) => sum + Math.max(0, row.reservedCents ?? 0), 0);
        if (!account || account.walletCents < amountCents + heldElsewhere) return { error: `Available wallet funds after active auction holds are not enough. Add ${pesos(amountCents)} or choose Cash on Delivery.`, status: 400 as const };
        const debited = await tx.update(users).set({ walletCents: sql`${users.walletCents} - ${amountCents}` }).where(and(eq(users.id, user.id), gte(users.walletCents, amountCents + heldElsewhere)));
        if (debited[0]?.affectedRows === 0) return { error: "Wallet balance changed during checkout. Refresh and try again.", status: 409 as const };
      }
      const orderId = `MH-AUC-${bid.id}-${Date.now()}`;
      await tx.insert(commerceOrders).values({ orderId, listingId: listing.listingId, auctionBidId: bid.id, buyerId: user.id, sellerId: listing.ownerId, quantity: 1, amountCents, payment, province, municipality, addressDetails, contactNumber: phone, destinationLatitude: latitude == null ? null : String(latitude), destinationLongitude: longitude == null ? null : String(longitude), status: "Processing" });
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
    await settleExpiredAuctions();
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    let decision: any;
    try {
      decision = await db.transaction(async (tx) => {
        const bid = (await tx.select().from(proxyBids).where(and(eq(proxyBids.id, Number(req.params.bidId)), eq(proxyBids.userId, user.id))).limit(1))[0];
        if (!bid || bid.status !== "won") return { error: "Only your won auction can be cancelled here.", status: 404 as const };
        const listing = (await tx.select().from(listingsOwned).where(eq(listingsOwned.listingId, bid.listingId)).limit(1))[0];
        if (!listing) return { error: "Auction listing not found.", status: 404 as const };
        if (listing.winnerCancellationAllowed === 0) return { error: "This seller does not allow change-of-mind cancellation after winning.", status: 409 as const };
        const order = (await tx.select().from(commerceOrders).where(eq(commerceOrders.auctionBidId, bid.id)).limit(1))[0];
        if (order && order.status !== "Processing") return { error: "Cancellation is only available before the order enters delivery. Contact support if there is a fulfillment issue.", status: 409 as const };

        // Claim the sold listing first. Every later mutation is in the same transaction;
        // if the bid/order claim loses a race, throwing rolls back the stock change too.
        const restored = await tx.update(listingsOwned).set({ lifecycle: "auction-ended", stock: listing.stock + 1 }).where(and(eq(listingsOwned.listingId, listing.listingId), eq(listingsOwned.lifecycle, "sold")));
        if (restored[0]?.affectedRows === 0) return { error: "The listing is no longer eligible for cancellation.", status: 409 as const };
        const cancelled = await tx.update(proxyBids).set({ status: "cancelled", currentBidCents: 0, reservedCents: 0 }).where(and(eq(proxyBids.id, bid.id), eq(proxyBids.status, "won")));
        if (cancelled[0]?.affectedRows === 0) throw new Error("WINNING_BID_ALREADY_RESOLVED");
        if (order) {
          const orderCancelled = await tx.update(commerceOrders).set({ status: "Cancelled" }).where(and(eq(commerceOrders.id, order.id), eq(commerceOrders.status, "Processing")));
          if (orderCancelled[0]?.affectedRows === 0) throw new Error("ORDER_ALREADY_ADVANCED");
          if (order.payment === "E-wallet") await tx.update(users).set({ walletCents: sql`${users.walletCents} + ${order.amountCents}` }).where(eq(users.id, user.id));
        }

        const rows = await tx.select().from(proxyBids).where(eq(proxyBids.listingId, bid.listingId)).orderBy(desc(proxyBids.createdAt));
        const runner = selectSecondChanceBid(rows, user.id);
        let offerSent = false;
        if (runner) {
          const offered = await tx.update(proxyBids).set({ status: "offered", currentBidCents: runner.maxBidCents, reservedCents: 0 }).where(and(eq(proxyBids.id, runner.id), eq(proxyBids.status, "outbid")));
          offerSent = offered[0]?.affectedRows !== 0;
        }
        return { bid, listing, runner: offerSent ? runner : null, offerSent, refundedCents: order?.payment === "E-wallet" ? order.amountCents : 0, orderId: order?.orderId ?? null };
      });
    } catch (error) {
      if (error instanceof Error && ["WINNING_BID_ALREADY_RESOLVED", "ORDER_ALREADY_ADVANCED"].includes(error.message)) return res.status(409).json({ ok: false, error: "This auction win changed while cancellation was being processed. Refresh the record and try again." });
      console.error("[Auctions] Winner cancellation transaction failed", error);
      return res.status(500).json({ ok: false, error: "Cancellation could not be completed. No refund or inventory change was saved." });
    }
    if ("error" in decision) return res.status(decision.status ?? 200).json({ ok: false, error: decision.error });
    const refundText = decision.refundedCents ? ` Your demo e-wallet payment of ${pesos(decision.refundedCents)} was returned.` : " No payment was collected, so no refund was needed.";
    await createNotification(user.id, "system", "Auction cancellation confirmed", `Your winning bid for “${decision.listing.title}” was cancelled.${refundText}`, decision.listing.listingId);
    if (decision.offerSent && decision.runner) {
      await createNotification(decision.runner.userId, "system", "Second-chance offer", `The winning buyer cancelled “${decision.listing.title}”. You were the next-highest bidder, so the item is offered to you at ${pesos(decision.runner.maxBidCents)}. Accept or decline this offer from your notification.`, decision.listing.listingId);
      await createNotification(decision.listing.ownerId, "system", "Winner cancelled — second chance offered", `The winning buyer cancelled “${decision.listing.title}”. A second-chance offer is waiting for the next-highest bidder.`, decision.listing.listingId);
    } else {
      await createNotification(decision.listing.ownerId, "system", "Auction ended without a sale", `The winning buyer cancelled “${decision.listing.title}” and no eligible second-highest bidder remains. It is in Inventory → Auction ended and can be re-auctioned or deleted.`, decision.listing.listingId);
    }
    publishAuctionUpdate(decision.bid.listingId);
    return res.json({ ok: true, secondChanceUserId: decision.runner?.userId ?? null, offerSent: decision.offerSent, refundedCents: decision.refundedCents });
  });
  app.post("/api/bids/:bidId/cancellation-request", async (req, res) => { const user = await requireUser(req, res); if (!user) return; const reason = String(req.body?.reason ?? "").trim().slice(0, 500); if (!reason) return res.status(400).json({ ok: false, error: "A cancellation reason is required." }); const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." }); const bid = (await db.select().from(proxyBids).where(and(eq(proxyBids.id, Number(req.params.bidId)), eq(proxyBids.userId, user.id))).limit(1))[0]; if (!bid || bid.status !== "active") return res.status(409).json({ ok: false, error: "Only an active bid can be submitted for cancellation." }); const existing = (await db.select().from(bidCancellationRequests).where(and(eq(bidCancellationRequests.bidId, bid.id), eq(bidCancellationRequests.status, "pending"))).limit(1))[0]; if (existing) return res.json({ ok: true, request: existing, existing: true }); const result = await db.insert(bidCancellationRequests).values({ bidId: bid.id, listingId: bid.listingId, userId: user.id, reason }).$returningId(); const request = (await db.select().from(bidCancellationRequests).where(eq(bidCancellationRequests.id, result[0].id)).limit(1))[0]; const listing = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, bid.listingId)).limit(1))[0]; if (listing) await createNotification(listing.ownerId, "system", "Bid cancellation request", `A buyer requested cancellation for “${listing.title}”: ${reason}`, bid.listingId); return res.status(201).json({ ok: true, request }); });
  app.get("/api/bids/cancellation-requests", async (req, res) => { const user = await requireUser(req, res); if (!user) return; const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." }); const all = await db.select().from(bidCancellationRequests); const owned = user.role === "admin" ? all : all.filter((request) => request.userId === user.id || request.listingId); const ownedListings = user.role === "admin" ? new Set(all.map((request) => request.listingId)) : new Set((await db.select({ listingId: listingsOwned.listingId }).from(listingsOwned).where(eq(listingsOwned.ownerId, user.id))).map((row) => row.listingId)); return res.json({ ok: true, requests: owned.filter((request) => user.role === "admin" || request.userId === user.id || ownedListings.has(request.listingId)) }); });
  app.patch("/api/bids/cancellation-requests/:requestId", async (req, res) => { const user = await requireUser(req, res); if (!user) return; const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." }); const request = (await db.select().from(bidCancellationRequests).where(eq(bidCancellationRequests.id, Number(req.params.requestId))).limit(1))[0]; if (!request) return res.status(404).json({ ok: false, error: "Cancellation request not found." }); const listing = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, request.listingId)).limit(1))[0]; if (user.role !== "admin" && listing?.ownerId !== user.id) return res.status(403).json({ ok: false, error: "Only the seller or an admin can decide this request." }); const status = req.body?.status === "approved" ? "approved" : req.body?.status === "denied" ? "denied" : null; if (!status) return res.status(400).json({ ok: false, error: "Status must be approved or denied." }); await db.update(bidCancellationRequests).set({ status }).where(eq(bidCancellationRequests.id, request.id)); if (status === "approved") await db.update(proxyBids).set({ status: "cancelled", currentBidCents: 0, reservedCents: 0 }).where(eq(proxyBids.id, request.bidId)); await createNotification(request.userId, "system", `Bid cancellation ${status}`, `Your bid cancellation request for “${listing?.title ?? request.listingId}” was ${status}.`, request.listingId); if (status === "approved") publishAuctionUpdate(request.listingId); return res.json({ ok: true, status }); });
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
    publishAuctionUpdate(listingId);
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
    publishAuctionUpdate(listingId);
    return res.json({ ok: true, listingId, status: "declined" });
  });
}
