ALTER TABLE `listing_size_variants`
  ADD COLUMN `color` varchar(40) NOT NULL DEFAULT '' AFTER `size`,
  DROP INDEX `size_variants_listing_size_unique`,
  ADD UNIQUE KEY `size_variants_listing_size_color_unique` (`listingId`, `size`, `color`);
--> statement-breakpoint

ALTER TABLE `commerce_orders`
  ADD COLUMN `variantColor` varchar(40) NULL AFTER `variantSize`;
--> statement-breakpoint

ALTER TABLE `savedSearches`
  ADD COLUMN `color` varchar(40) NULL AFTER `size`;
