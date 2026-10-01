import { int, longtext, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
  province: varchar("province", { length: 120 }),
  municipality: varchar("municipality", { length: 120 }),
  storeName: varchar("storeName", { length: 160 }),
  storeImage: longtext("storeImage"),
  sellerEnabled: int("sellerEnabled").default(0).notNull(),
  walletCents: int("walletCents").default(0).notNull(),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin", "rider"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const proxyBids = mysqlTable("proxy_bids", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  listingId: varchar("listingId", { length: 96 }).notNull(),
  maxBidCents: int("maxBidCents").notNull(),
  incrementCents: int("incrementCents").notNull(),
  currentBidCents: int("currentBidCents").notNull(),
  status: mysqlEnum("status", ["active", "won", "outbid", "cancelled"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProxyBid = typeof proxyBids.$inferSelect;

export const listingsOwned = mysqlTable("listings_owned", {
  id: int("id").autoincrement().primaryKey(),
  listingId: varchar("listingId", { length: 128 }).notNull().unique(),
  ownerId: int("ownerId").notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  description: text("description").notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  subcategory: varchar("subcategory", { length: 100 }),
  listingType: mysqlEnum("listingType", ["Auction", "Buy now", "Both"]).notNull(),
  priceCents: int("priceCents").notNull(),
  buyNowPriceCents: int("buyNowPriceCents"),
  stock: int("stock").notNull().default(1),
  condition: mysqlEnum("condition", ["New", "Like new", "Good"]).notNull(),
  /** JSON array of product photo data URLs; first item remains the cover image. */
  imageData: longtext("imageData"),
  auctionEndAt: timestamp("auctionEndAt"),
  reserveThresholdCents: int("reserveThresholdCents"),
  minimumIncrementCents: int("minimumIncrementCents"),
  antiSnipeSeconds: int("antiSnipeSeconds").default(120),
  settledAt: timestamp("settledAt"),
  lifecycle: mysqlEnum("lifecycle", ["draft", "official", "deleted"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const commerceOrders = mysqlTable("commerce_orders", {
  id: int("id").autoincrement().primaryKey(),
  orderId: varchar("orderId", { length: 64 }).notNull().unique(),
  listingId: varchar("listingId", { length: 128 }).notNull(),
  buyerId: int("buyerId").notNull(),
  sellerId: int("sellerId").notNull(),
  quantity: int("quantity").notNull().default(1),
  amountCents: int("amountCents").notNull(),
  payment: mysqlEnum("payment", ["Online", "COD"]).notNull(),
  province: varchar("province", { length: 120 }).notNull(),
  municipality: varchar("municipality", { length: 120 }).notNull(),
  addressDetails: varchar("addressDetails", { length: 240 }),
  destinationLatitude: varchar("destinationLatitude", { length: 32 }),
  destinationLongitude: varchar("destinationLongitude", { length: 32 }),
  status: mysqlEnum("status", ["Processing", "Rider assigned", "Picked up", "In transit", "Delivered", "Cancelled"]).default("Processing").notNull(),
  riderId: int("riderId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const riderLocations = mysqlTable("rider_locations", {
  riderId: int("riderId").primaryKey(),
  orderId: varchar("orderId", { length: 64 }),
  latitude: varchar("latitude", { length: 32 }).notNull(),
  longitude: varchar("longitude", { length: 32 }).notNull(),
  accuracy: varchar("accuracy", { length: 32 }),
  moving: int("moving").notNull().default(0),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const paymentOrders = mysqlTable("payment_orders", {
  id: int("id").autoincrement().primaryKey(),
  orderId: varchar("orderId", { length: 64 }).notNull().unique(),
  stripeCheckoutSessionId: varchar("stripeCheckoutSessionId", { length: 128 }).notNull().unique(),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 128 }),
  currency: varchar("currency", { length: 3 }).notNull(),
  amountMinor: int("amountMinor").notNull(),
  customerEmail: varchar("customerEmail", { length: 320 }).notNull(),
  customerName: varchar("customerName", { length: 120 }).notNull(),
  itemTitle: varchar("itemTitle", { length: 160 }).notNull(),
  status: mysqlEnum("status", ["processing", "paid", "failed", "cancelled"]).default("processing").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const stripeEvents = mysqlTable("stripe_events", {
  id: varchar("id", { length: 128 }).primaryKey(),
  type: varchar("type", { length: 120 }).notNull(),
  eventCreatedAt: timestamp("eventCreatedAt").notNull(),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
});

export const shippingLabels = mysqlTable("shipping_labels", {
  id: int("id").autoincrement().primaryKey(),
  labelId: varchar("labelId", { length: 64 }).notNull().unique(),
  orderId: varchar("orderId", { length: 64 }).notNull(),
  tracking: varchar("tracking", { length: 80 }).notNull().unique(),
  carrier: varchar("carrier", { length: 80 }).notNull(),
  service: varchar("service", { length: 80 }).notNull(),
  destination: varchar("destination", { length: 120 }).notNull(),
  packageType: varchar("packageType", { length: 60 }).notNull(),
  weightGrams: int("weightGrams").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  recipientId: int("recipientId").notNull(),
  type: mysqlEnum("type", ["auction_won", "delivery_update", "order_created", "system"]).notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  message: text("message").notNull(),
  entityId: varchar("entityId", { length: 128 }),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const messages = mysqlTable("messages", {
  id: int("id").autoincrement().primaryKey(),
  listingId: varchar("listingId", { length: 128 }),
  senderId: int("senderId").notNull(),
  recipientId: int("recipientId").notNull(),
  body: text("body").notNull(),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const wishlists = mysqlTable("wishlists", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  listingId: varchar("listingId", { length: 128 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const savedSearches = mysqlTable("savedSearches", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  query: varchar("query", { length: 255 }).notNull().default(""),
  filter: varchar("filter", { length: 80 }).notNull().default("All items"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const bidCancellationRequests = mysqlTable("bid_cancellation_requests", {
  id: int("id").autoincrement().primaryKey(),
  bidId: int("bidId").notNull(),
  listingId: varchar("listingId", { length: 128 }).notNull(),
  userId: int("userId").notNull(),
  reason: varchar("reason", { length: 500 }).notNull(),
  status: mysqlEnum("status", ["pending", "approved", "denied"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PaymentOrder = typeof paymentOrders.$inferSelect;
export type ShippingLabel = typeof shippingLabels.$inferSelect;
