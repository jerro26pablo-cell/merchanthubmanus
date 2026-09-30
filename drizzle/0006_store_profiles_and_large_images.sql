ALTER TABLE `users` ADD `storeName` varchar(160);
--> statement-breakpoint
ALTER TABLE `users` ADD `storeImage` longtext;
--> statement-breakpoint
ALTER TABLE `users` ADD `sellerEnabled` int NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `listings_owned` MODIFY COLUMN `imageData` longtext;
