ALTER TABLE `listings_owned` ADD `winnerCancellationAllowed` int NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `proxy_bids` ADD `reservedCents` int NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `proxy_bids` ADD `shippingPhone` varchar(32);
--> statement-breakpoint
ALTER TABLE `proxy_bids` ADD `shippingProvince` varchar(120);
--> statement-breakpoint
ALTER TABLE `proxy_bids` ADD `shippingMunicipality` varchar(120);
--> statement-breakpoint
ALTER TABLE `proxy_bids` ADD `shippingAddressDetails` varchar(240);
--> statement-breakpoint
ALTER TABLE `proxy_bids` ADD `shippingLatitude` varchar(32);
--> statement-breakpoint
ALTER TABLE `proxy_bids` ADD `shippingLongitude` varchar(32);
--> statement-breakpoint
ALTER TABLE `commerce_orders` ADD `auctionBidId` int;
--> statement-breakpoint
ALTER TABLE `commerce_orders` ADD UNIQUE INDEX `commerce_orders_auction_bid_id_unique` (`auctionBidId`);
--> statement-breakpoint
ALTER TABLE `commerce_orders` ADD `contactNumber` varchar(32);
--> statement-breakpoint
ALTER TABLE `commerce_orders` MODIFY `payment` enum('Online','COD','E-wallet') NOT NULL;
