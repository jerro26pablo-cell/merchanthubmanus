CREATE TABLE `auction_bid_event_batches` (
  `id` int AUTO_INCREMENT NOT NULL,
  `listingId` varchar(128) NOT NULL,
  `submittedProxyBidId` int NOT NULL,
  `eventsJson` longtext NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `auction_bid_event_batches_id` PRIMARY KEY(`id`),
  INDEX `auction_bid_event_batches_listing_seq_idx` (`listingId`, `id`)
);
