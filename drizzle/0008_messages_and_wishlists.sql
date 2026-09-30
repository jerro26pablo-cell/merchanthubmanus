CREATE TABLE `messages` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `listingId` varchar(128),
  `senderId` int NOT NULL,
  `recipientId` int NOT NULL,
  `body` text NOT NULL,
  `readAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `wishlists` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `listingId` varchar(128) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
