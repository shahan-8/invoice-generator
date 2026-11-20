-- Run once against databases that already have the original payment tables.
ALTER TABLE payment_requests ADD COLUMN plan TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE payment_sessions ADD COLUMN plan TEXT NOT NULL DEFAULT 'monthly';
