UPDATE `listings_owned` SET `listingType` = 'Auction' WHERE `listingType` = 'Both';
--> statement-breakpoint
ALTER TABLE `listings_owned` MODIFY COLUMN `listingType` enum('Auction','Buy now') NOT NULL;
--> statement-breakpoint
ALTER TABLE `listings_owned` DROP COLUMN `buyNowPriceCents`;
--> statement-breakpoint
ALTER TABLE `listing_price_history` DROP COLUMN `previousBuyNowPriceCents`;
--> statement-breakpoint
ALTER TABLE `listing_price_history` DROP COLUMN `newBuyNowPriceCents`;
--> statement-breakpoint
UPDATE `savedSearches` SET `filter` = 'Auction' WHERE `filter` = 'Both';
