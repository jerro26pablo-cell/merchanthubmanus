ALTER TABLE `users` ADD `sellerApplicationStatus` enum('none','pending','approved','denied') NOT NULL DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE `users` ADD `deactivatedAt` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `proxy_bids` ADD `acceptanceDeadline` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `listings_owned` MODIFY `lifecycle` enum('draft','official','auction-ended','sold','canceled','deleted') NOT NULL DEFAULT 'draft';
