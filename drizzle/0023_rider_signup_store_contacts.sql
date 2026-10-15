ALTER TABLE `users`
  ADD COLUMN `storePhone` varchar(32) NULL,
  ADD COLUMN `storeEmail` varchar(320) NULL,
  ADD COLUMN `storeProvince` varchar(120) NULL,
  ADD COLUMN `storeMunicipality` varchar(120) NULL,
  ADD COLUMN `storeAddress` text NULL,
  ADD COLUMN `riderApplicationStatus` enum('none','pending','approved','denied') NOT NULL DEFAULT 'none';
