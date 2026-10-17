CREATE TABLE `marketplace_ratings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `orderId` varchar(64) NOT NULL,
  `listingId` varchar(128) NOT NULL,
  `buyerId` int NOT NULL,
  `sellerId` int NOT NULL,
  `target` enum('item','seller') NOT NULL,
  `rating` int NOT NULL,
  `comment` varchar(500),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `marketplace_ratings_id` PRIMARY KEY(`id`),
  CONSTRAINT `marketplace_ratings_buyer_order_target_unique` UNIQUE(`buyerId`,`orderId`,`target`),
  INDEX `marketplace_ratings_listing_idx` (`listingId`),
  INDEX `marketplace_ratings_seller_idx` (`sellerId`)
);
--> statement-breakpoint
CREATE TABLE `seller_reports` (
  `id` int AUTO_INCREMENT NOT NULL,
  `sellerId` int NOT NULL,
  `reporterId` int NOT NULL,
  `listingId` varchar(128),
  `reason` varchar(160) NOT NULL,
  `details` varchar(1000),
  `status` enum('open','reviewed','dismissed') NOT NULL DEFAULT 'open',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE now(),
  CONSTRAINT `seller_reports_id` PRIMARY KEY(`id`)
);
