CREATE TABLE `commerce_orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` varchar(64) NOT NULL,
	`listingId` varchar(128) NOT NULL,
	`buyerId` int NOT NULL,
	`sellerId` int NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`amountCents` int NOT NULL,
	`payment` enum('Online','COD') NOT NULL,
	`province` varchar(120) NOT NULL,
	`municipality` varchar(120) NOT NULL,
	`addressDetails` varchar(240),
	`status` enum('Processing','Rider assigned','Picked up','In transit','Delivered','Cancelled') NOT NULL DEFAULT 'Processing',
	`riderId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `commerce_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `commerce_orders_orderId_unique` UNIQUE(`orderId`)
);
--> statement-breakpoint
CREATE TABLE `listings_owned` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listingId` varchar(128) NOT NULL,
	`ownerId` int NOT NULL,
	`title` varchar(180) NOT NULL,
	`description` text NOT NULL,
	`category` varchar(80) NOT NULL,
	`listingType` enum('Auction','Buy now','Both') NOT NULL,
	`priceCents` int NOT NULL,
	`stock` int NOT NULL DEFAULT 1,
	`condition` enum('New','Like new','Good') NOT NULL,
	`imageData` text,
	`auctionEndAt` timestamp,
	`reserveThresholdCents` int,
	`minimumIncrementCents` int,
	`lifecycle` enum('draft','official','deleted') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `listings_owned_id` PRIMARY KEY(`id`),
	CONSTRAINT `listings_owned_listingId_unique` UNIQUE(`listingId`)
);
--> statement-breakpoint
CREATE TABLE `rider_locations` (
	`riderId` int NOT NULL,
	`orderId` varchar(64),
	`latitude` varchar(32) NOT NULL,
	`longitude` varchar(32) NOT NULL,
	`accuracy` varchar(32),
	`moving` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `rider_locations_riderId` PRIMARY KEY(`riderId`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','rider') NOT NULL DEFAULT 'user';