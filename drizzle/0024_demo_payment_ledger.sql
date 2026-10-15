ALTER TABLE `payment_orders`
  MODIFY COLUMN `stripeCheckoutSessionId` varchar(128) NULL,
  ADD COLUMN `paymentMethod` enum('demo_wallet','cod','stripe') NOT NULL DEFAULT 'stripe' AFTER `orderId`,
  MODIFY COLUMN `status` enum('pending','processing','paid','failed','cancelled') NOT NULL DEFAULT 'processing';
