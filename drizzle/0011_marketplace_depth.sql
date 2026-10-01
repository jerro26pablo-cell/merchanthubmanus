ALTER TABLE `listings_owned` ADD `subcategory` varchar(100) NULL;
--> statement-breakpoint
ALTER TABLE `listings_owned` ADD `antiSnipeSeconds` int NOT NULL DEFAULT 120;
--> statement-breakpoint
CREATE TABLE `bid_cancellation_requests` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `bidId` int NOT NULL,
  `listingId` varchar(128) NOT NULL,
  `userId` int NOT NULL,
  `reason` varchar(500) NOT NULL,
  `status` enum('pending','approved','denied') NOT NULL DEFAULT 'pending',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
