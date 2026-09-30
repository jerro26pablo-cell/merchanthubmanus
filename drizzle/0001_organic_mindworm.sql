CREATE TABLE `payment_orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` varchar(64) NOT NULL,
	`stripeCheckoutSessionId` varchar(128) NOT NULL,
	`stripePaymentIntentId` varchar(128),
	`currency` varchar(3) NOT NULL,
	`amountMinor` int NOT NULL,
	`customerEmail` varchar(320) NOT NULL,
	`customerName` varchar(120) NOT NULL,
	`itemTitle` varchar(160) NOT NULL,
	`status` enum('processing','paid','failed','cancelled') NOT NULL DEFAULT 'processing',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payment_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `payment_orders_orderId_unique` UNIQUE(`orderId`),
	CONSTRAINT `payment_orders_stripeCheckoutSessionId_unique` UNIQUE(`stripeCheckoutSessionId`)
);
--> statement-breakpoint
CREATE TABLE `stripe_events` (
	`id` varchar(128) NOT NULL,
	`type` varchar(120) NOT NULL,
	`eventCreatedAt` timestamp NOT NULL,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stripe_events_id` PRIMARY KEY(`id`)
);
