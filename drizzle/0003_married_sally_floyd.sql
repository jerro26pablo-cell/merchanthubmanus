CREATE TABLE `proxy_bids` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`listingId` varchar(96) NOT NULL,
	`maxBidCents` int NOT NULL,
	`incrementCents` int NOT NULL,
	`currentBidCents` int NOT NULL,
	`status` enum('active','won','outbid','cancelled') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `proxy_bids_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `province` varchar(120);--> statement-breakpoint
ALTER TABLE `users` ADD `municipality` varchar(120);--> statement-breakpoint
ALTER TABLE `users` ADD `walletCents` int DEFAULT 0 NOT NULL;