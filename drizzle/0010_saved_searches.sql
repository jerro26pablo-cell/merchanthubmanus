CREATE TABLE `savedSearches` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `name` varchar(120) NOT NULL,
  `query` varchar(255) NOT NULL DEFAULT '',
  `filter` varchar(80) NOT NULL DEFAULT 'All items',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
