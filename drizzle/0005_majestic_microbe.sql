CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recipientId` int NOT NULL,
	`type` enum('auction_won','delivery_update','order_created','system') NOT NULL,
	`title` varchar(160) NOT NULL,
	`message` text NOT NULL,
	`entityId` varchar(128),
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `listings_owned` ADD `settledAt` timestamp;