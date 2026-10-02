import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  bidCancellationRequests,
  commerceOrders,
  listingsOwned,
  messages,
  notifications,
  paymentOrders,
  proxyBids,
  riderLocations,
  savedSearches,
  shippingLabels,
  users,
  wishlists,
} from "../drizzle/schema";

const TARGET_EMAILS = ["test1@gmail.com", "buyer1@gmail.com", "buyer2@gmail.com"] as const;
const BID_ALERT_TITLES = ["You are winning", "You were outbid"] as const;

type ResetCounts = {
  accountsMatched: number;
  sellerListings: number;
  bidRows: number;
  bidCancellationRequests: number;
  orders: number;
  riderLocations: number;
  shippingLabels: number;
  notifications: number;
  messages: number;
  watchlistEntries: number;
  savedSearches: number;
  paymentLedgerRowsPreserved: number;
  otherSellerAuctionsToRecalculate: number;
  otherSellerSettledWinsRequiringReview: number;
};

class ResetBlocked extends Error {
  constructor(readonly code: "accounts_not_found" | "settled_wins_need_review") { super(code); }
}

function safeTokenMatch(expected: string | undefined, actual: string | undefined) {
  if (!expected || !actual) return false;
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(actual, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function collectResetPlan(queryable: any) {
  const matched = await queryable.select({ id: users.id, email: users.email }).from(users)
    .where(inArray(sql`LOWER(${users.email})`, [...TARGET_EMAILS]));
  const matchesByEmail = new Map<string, number[]>();
  for (const row of matched) {
    const email = String(row.email ?? "").toLowerCase();
    matchesByEmail.set(email, [...(matchesByEmail.get(email) ?? []), row.id]);
  }
  if (TARGET_EMAILS.some((email) => matchesByEmail.get(email)?.length !== 1)) throw new ResetBlocked("accounts_not_found");

  const targetUsers = TARGET_EMAILS.map((email) => matchesByEmail.get(email)![0]);
  const [sellerId, ...buyerIds] = targetUsers;
  const sellerListings = await queryable.select().from(listingsOwned).where(eq(listingsOwned.ownerId, sellerId));
  const listingIds: string[] = sellerListings.map((row: typeof listingsOwned.$inferSelect) => row.listingId);
  const allListings = await queryable.select().from(listingsOwned);
  const listingMap = new Map<string, typeof listingsOwned.$inferSelect>(allListings.map((row: typeof listingsOwned.$inferSelect) => [row.listingId, row]));

  const bidPredicate = listingIds.length
    ? or(inArray(proxyBids.userId, buyerIds), inArray(proxyBids.listingId, listingIds))
    : inArray(proxyBids.userId, buyerIds);
  const bidRows = await queryable.select().from(proxyBids).where(bidPredicate);
  const bidIds: number[] = bidRows.map((row: typeof proxyBids.$inferSelect) => row.id);
  const orderPredicate = or(inArray(commerceOrders.buyerId, targetUsers), inArray(commerceOrders.sellerId, targetUsers));
  const orderRows = await queryable.select().from(commerceOrders).where(orderPredicate);
  const orderIds: string[] = orderRows.map((row: typeof commerceOrders.$inferSelect) => row.orderId);

  const cancellationClauses = [inArray(bidCancellationRequests.userId, targetUsers)];
  if (listingIds.length) cancellationClauses.push(inArray(bidCancellationRequests.listingId, listingIds));
  if (bidIds.length) cancellationClauses.push(inArray(bidCancellationRequests.bidId, bidIds));
  const cancellationRows = await queryable.select({ id: bidCancellationRequests.id }).from(bidCancellationRequests).where(or(...cancellationClauses));

  const notificationClauses = [inArray(notifications.recipientId, targetUsers)];
  if (listingIds.length) notificationClauses.push(inArray(notifications.entityId, listingIds));
  if (orderIds.length) notificationClauses.push(inArray(notifications.entityId, orderIds));
  const notificationRows = await queryable.select({ id: notifications.id }).from(notifications).where(or(...notificationClauses));
  const messageRows = await queryable.select({ id: messages.id }).from(messages).where(or(inArray(messages.senderId, targetUsers), inArray(messages.recipientId, targetUsers)));
  const wishlistRows = await queryable.select({ id: wishlists.id }).from(wishlists).where(inArray(wishlists.userId, targetUsers));
  const searchRows = await queryable.select({ id: savedSearches.id }).from(savedSearches).where(inArray(savedSearches.userId, targetUsers));
  const locationRows = orderIds.length
    ? await queryable.select({ id: riderLocations.riderId }).from(riderLocations).where(inArray(riderLocations.orderId, orderIds))
    : [];
  const labelRows = orderIds.length
    ? await queryable.select({ id: shippingLabels.id }).from(shippingLabels).where(inArray(shippingLabels.orderId, orderIds))
    : [];
  const paymentRows = orderIds.length
    ? await queryable.select({ id: paymentOrders.id }).from(paymentOrders).where(inArray(paymentOrders.orderId, orderIds))
    : [];

  const targetSet = new Set(targetUsers);
  const sellerListingSet = new Set(listingIds);
  const externalSettledWins = bidRows.filter((bid: typeof proxyBids.$inferSelect) => {
    if (!buyerIds.includes(bid.userId) || sellerListingSet.has(bid.listingId) || bid.status !== "won") return false;
    const listing = listingMap.get(bid.listingId);
    return Boolean(listing && listing.ownerId !== sellerId);
  });
  const externalLiveListingIds = Array.from(new Set<string>(bidRows.filter((bid: typeof proxyBids.$inferSelect) => {
    if (!buyerIds.includes(bid.userId) || sellerListingSet.has(bid.listingId)) return false;
    const listing = listingMap.get(bid.listingId);
    return Boolean(listing && !targetSet.has(listing.ownerId) && listing.lifecycle === "official" && !listing.settledAt && (!listing.auctionEndAt || listing.auctionEndAt.getTime() > Date.now()) && (listing.listingType === "Auction" || listing.listingType === "Both"));
  }).map((bid: typeof proxyBids.$inferSelect) => bid.listingId)));

  const counts: ResetCounts = {
    accountsMatched: targetUsers.length,
    sellerListings: sellerListings.length,
    bidRows: bidRows.length,
    bidCancellationRequests: cancellationRows.length,
    orders: orderRows.length,
    riderLocations: locationRows.length,
    shippingLabels: labelRows.length,
    notifications: notificationRows.length,
    messages: messageRows.length,
    watchlistEntries: wishlistRows.length,
    savedSearches: searchRows.length,
    paymentLedgerRowsPreserved: paymentRows.length,
    otherSellerAuctionsToRecalculate: externalLiveListingIds.length,
    otherSellerSettledWinsRequiringReview: externalSettledWins.length,
  };
  return { targetUsers, sellerId, buyerIds, sellerListings, listingIds, bidIds, orderIds, bidRows, allListings, externalLiveListingIds, counts };
}

function resultCounts(plan: Awaited<ReturnType<typeof collectResetPlan>>) {
  const { counts } = plan;
  return { ...counts, walletsPreserved: true, accountsPreserved: true, paymentLedgersPreserved: true };
}

export function registerTestAccountResetRoute(app: Express) {
  const consumedTokens = new Set<string>();
  app.post("/api/internal/test-account-reset", async (req: Request, res: Response) => {
    const expectedToken = process.env.MERCHANTHUB_TEST_RESET_TOKEN;
    const authHeader = req.header("authorization") ?? "";
    const actualToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!safeTokenMatch(expectedToken, actualToken)) return res.status(404).json({ ok: false, error: "Not found." });
    res.setHeader("Cache-Control", "no-store");

    const mode = req.body?.mode;
    if (mode !== "preview" && mode !== "execute") return res.status(400).json({ ok: false, error: "mode must be preview or execute." });
    if (mode === "execute" && req.body?.confirmation !== "RESET THE THREE APPROVED TEST ACCOUNTS") return res.status(400).json({ ok: false, error: "Explicit reset confirmation is required." });
    const tokenFingerprint = crypto.createHash("sha256").update(actualToken).digest("hex");
    if (mode === "execute" && consumedTokens.has(tokenFingerprint)) return res.status(409).json({ ok: false, error: "This one-time reset token has already been used." });

    const db = await getDb();
    if (!db) return res.status(503).json({ ok: false, error: "The application database is unavailable." });

    try {
      if (mode === "preview") {
        const plan = await collectResetPlan(db);
        return res.json({ ok: true, mode, counts: resultCounts(plan), needsAdditionalApproval: plan.counts.otherSellerSettledWinsRequiringReview > 0 });
      }

      const counts = await db.transaction(async (tx) => {
        const plan = await collectResetPlan(tx);
        if (plan.counts.otherSellerSettledWinsRequiringReview > 0) throw new ResetBlocked("settled_wins_need_review");

        const { targetUsers, buyerIds, sellerId, listingIds, bidIds, orderIds, externalLiveListingIds } = plan;
        const bidIdsWhere = bidIds.length ? inArray(bidCancellationRequests.bidId, bidIds) : undefined;
        const listingIdsWhere = listingIds.length ? inArray(bidCancellationRequests.listingId, listingIds) : undefined;
        const cancellationWhere = or(inArray(bidCancellationRequests.userId, targetUsers), listingIdsWhere, bidIdsWhere);
        await tx.delete(bidCancellationRequests).where(cancellationWhere);

        const bidWhere = listingIds.length
          ? or(inArray(proxyBids.userId, buyerIds), inArray(proxyBids.listingId, listingIds))
          : inArray(proxyBids.userId, buyerIds);
        await tx.delete(proxyBids).where(bidWhere);

        const notificationClauses = [inArray(notifications.recipientId, targetUsers)];
        if (listingIds.length) notificationClauses.push(inArray(notifications.entityId, listingIds));
        if (orderIds.length) notificationClauses.push(inArray(notifications.entityId, orderIds));
        await tx.delete(notifications).where(or(...notificationClauses));

        if (externalLiveListingIds.length) {
          await tx.delete(notifications).where(and(
            inArray(notifications.entityId, externalLiveListingIds),
            eq(notifications.type, "system"),
            inArray(notifications.title, [...BID_ALERT_TITLES]),
          ));
        }
        await tx.delete(messages).where(or(inArray(messages.senderId, targetUsers), inArray(messages.recipientId, targetUsers)));
        await tx.delete(wishlists).where(inArray(wishlists.userId, targetUsers));
        await tx.delete(savedSearches).where(inArray(savedSearches.userId, targetUsers));
        if (orderIds.length) {
          await tx.delete(shippingLabels).where(inArray(shippingLabels.orderId, orderIds));
          await tx.delete(riderLocations).where(inArray(riderLocations.orderId, orderIds));
          await tx.delete(commerceOrders).where(inArray(commerceOrders.orderId, orderIds));
        }
        if (listingIds.length) await tx.delete(listingsOwned).where(and(eq(listingsOwned.ownerId, sellerId), inArray(listingsOwned.listingId, listingIds)));

        for (const listingId of externalLiveListingIds) {
          const listing = plan.allListings.find((row: typeof listingsOwned.$inferSelect) => row.listingId === listingId);
          if (!listing) continue;
          const currentBids = await tx.select().from(proxyBids).where(and(eq(proxyBids.listingId, listingId), eq(proxyBids.status, "active")));
          currentBids.sort((a: typeof proxyBids.$inferSelect, b: typeof proxyBids.$inferSelect) => b.maxBidCents - a.maxBidCents || a.id - b.id);
          await tx.update(proxyBids).set({ status: "outbid", currentBidCents: 0 }).where(and(eq(proxyBids.listingId, listingId), eq(proxyBids.status, "active")));
          const leader = currentBids[0];
          if (leader) {
            const runnerUp = currentBids[1];
            const currentBidCents = Math.min(leader.maxBidCents, Math.max(listing.priceCents, runnerUp ? runnerUp.maxBidCents + leader.incrementCents : listing.priceCents));
            await tx.update(proxyBids).set({ status: "active", currentBidCents }).where(eq(proxyBids.id, leader.id));
            await tx.insert(notifications).values({ recipientId: listing.ownerId, type: "system", title: "Auction bids updated", message: `A test-account reset removed bids on “${listing.title}”. The current leading bid is ${money(currentBidCents)}.`, entityId: listingId });
            for (const bid of currentBids) {
              await tx.insert(notifications).values({ recipientId: bid.userId, type: "system", title: bid.id === leader.id ? "You are winning" : "You were outbid", message: bid.id === leader.id ? `You are now leading “${listing.title}” at ${money(currentBidCents)} after a test-account reset.` : `The leading bid on “${listing.title}” is now ${money(currentBidCents)} after a test-account reset.`, entityId: listingId });
            }
          } else {
            await tx.insert(notifications).values({ recipientId: listing.ownerId, type: "system", title: "Auction bids updated", message: `A test-account reset removed the bids on “${listing.title}”. It currently has no active bids.`, entityId: listingId });
          }
        }

        return resultCounts(plan);
      });
      consumedTokens.add(tokenFingerprint);
      return res.json({ ok: true, mode, counts });
    } catch (error) {
      if (error instanceof ResetBlocked && error.code === "accounts_not_found") return res.status(409).json({ ok: false, error: "The three approved accounts must each match exactly once. No data was changed." });
      if (error instanceof ResetBlocked && error.code === "settled_wins_need_review") return res.status(409).json({ ok: false, error: "A buyer has a completed win on another seller’s auction. No data was changed; a narrower follow-up decision is required." });
      console.error("[Test account reset] Scoped operation failed:", error instanceof Error ? error.message : "unknown error");
      return res.status(500).json({ ok: false, error: "The scoped reset failed and was rolled back." });
    }
  });
}

function money(cents: number) {
  return `₱${(cents / 100).toLocaleString("en-PH")}`;
}
