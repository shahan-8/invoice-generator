-- BillDost Database Schema for Cloudflare D1 (SQLite)

-- 1. Users table (Freelancer business profiles)
CREATE TABLE IF NOT EXISTS users (
  telegram_id TEXT PRIMARY KEY,
  business_name TEXT,
  business_address TEXT,
  phone TEXT,
  email TEXT,
  gstin TEXT,
  upi_id TEXT,
  upi_phone TEXT,
  upi_qr_file_id TEXT,
  gst_rate INTEGER DEFAULT 0,
  invoice_counter INTEGER DEFAULT 0,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 2. Duplicate Telegram update protection
CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY,
  processed_at TEXT DEFAULT (datetime('now'))
);

-- 3. Invoice history metadata (Zero customer data stored)
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  date TEXT NOT NULL,
  summary TEXT NOT NULL,
  subtotal_paise INTEGER NOT NULL,
  gst_paise INTEGER NOT NULL,
  grand_total_paise INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(telegram_id);

-- Paid access and manual UPI review workflow.
CREATE TABLE IF NOT EXISTS subscriptions (
  telegram_id TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  screenshot_file_id TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'monthly' CHECK (plan IN ('monthly', 'yearly')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT,
  reviewed_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_payment_per_user
  ON payment_requests(telegram_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS payment_sessions (
  telegram_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'monthly' CHECK (plan IN ('monthly', 'yearly')),
  started_at TEXT DEFAULT (datetime('now'))
);

-- Shared sliding-window rate limit across Worker instances.
CREATE TABLE IF NOT EXISTS rate_limits (
  telegram_id TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL
);


