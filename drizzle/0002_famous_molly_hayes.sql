CREATE TABLE `shipping_labels` (
	`id` int AUTO_INCREMENT NOT NULL,
	`labelId` varchar(64) NOT NULL,
	`orderId` varchar(64) NOT NULL,
	`tracking` varchar(80) NOT NULL,
	`carrier` varchar(80) NOT NULL,
	`service` varchar(80) NOT NULL,
	`destination` varchar(120) NOT NULL,
	`packageType` varchar(60) NOT NULL,
	`weightGrams` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shipping_labels_id` PRIMARY KEY(`id`),
	CONSTRAINT `shipping_labels_labelId_unique` UNIQUE(`labelId`),
	CONSTRAINT `shipping_labels_tracking_unique` UNIQUE(`tracking`)
);
