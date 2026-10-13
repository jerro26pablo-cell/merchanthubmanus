CREATE TABLE IF NOT EXISTS `listing_size_variants` (
  `id` int NOT NULL AUTO_INCREMENT,
  `listingId` varchar(128) NOT NULL,
  `size` varchar(32) NOT NULL,
  `priceCents` int NOT NULL,
  `stock` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `size_variants_listing_size_unique` (`listingId`, `size`),
  KEY `size_variants_listing_idx` (`listingId`)
) ENGINE=InnoDB;
--> statement-breakpoint

ALTER TABLE `commerce_orders`
  ADD COLUMN `variantSize` varchar(32) NULL AFTER `quantity`,
  ADD COLUMN `unitPriceCents` int NULL AFTER `variantSize`;
--> statement-breakpoint

ALTER TABLE `savedSearches`
  ADD COLUMN `size` varchar(32) NULL AFTER `filter`;
