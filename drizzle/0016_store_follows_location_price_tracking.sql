ALTER TABLE `savedSearches` ADD `province` varchar(120) NULL;
--> statement-breakpoint
ALTER TABLE `savedSearches` ADD `municipality` varchar(120) NULL;
--> statement-breakpoint
CREATE TABLE `store_follows` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `followerId` int NOT NULL,
  `sellerId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `store_follows_unique` (`followerId`, `sellerId`)
);
--> statement-breakpoint
CREATE TABLE `listing_price_history` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `listingId` varchar(128) NOT NULL,
  `sellerId` int NOT NULL,
  `previousPriceCents` int NOT NULL,
  `newPriceCents` int NOT NULL,
  `previousBuyNowPriceCents` int NULL,
  `newBuyNowPriceCents` int NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `listing_price_history_listing_created` (`listingId`, `createdAt`)
);
