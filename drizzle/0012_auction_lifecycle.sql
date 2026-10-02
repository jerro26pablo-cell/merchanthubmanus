ALTER TABLE `proxy_bids` MODIFY `status` enum('active','won','outbid','offered','cancelled') NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE `listings_owned` MODIFY `lifecycle` enum('draft','official','auction-ended','sold','deleted') NOT NULL DEFAULT 'draft';
