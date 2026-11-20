/**
 * Cloudflare D1 Database Helper for BillDost
 */

/**
 * Retrieve a user's freelancer business profile.
 *
 * @param {D1Database} db - Cloudflare D1 binding
 * @param {string|number} telegramId - Unique Telegram User ID
 * @returns {Promise<object|null>} Profile object or null if not found
 */
export async function getUserProfile(db, telegramId) {
  if (!db) return null;
  const query = "SELECT * FROM users WHERE telegram_id = ?";
  const user = await db.prepare(query).bind(String(telegramId)).first();
  return user || null;
}

/**
 * Upsert (insert or update) a freelancer's business profile.
 *
 * @param {D1Database} db - Cloudflare D1 binding
 * @param {object} profile - Profile fields
 * @returns {Promise<object>} D1 execution result
 */
export async function upsertUserProfile(db, profile) {
  if (!db) return null;
  const query = `
    INSERT INTO users (
      telegram_id, business_name, business_address, phone, email, gstin, upi_id, upi_phone, upi_qr_file_id, gst_rate, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(telegram_id) DO UPDATE SET
      business_name = excluded.business_name,
      business_address = excluded.business_address,
      phone = excluded.phone,
      email = excluded.email,
      gstin = excluded.gstin,
      upi_id = excluded.upi_id,
      upi_phone = excluded.upi_phone,
      upi_qr_file_id = excluded.upi_qr_file_id,
      gst_rate = excluded.gst_rate,
      updated_at = datetime('now');
  `;

  return await db
    .prepare(query)
    .bind(
      String(profile.telegram_id),
      profile.business_name || null,
      profile.business_address || null,
      profile.phone || null,
      profile.email || null,
      profile.gstin || null,
      profile.upi_id || null,
      profile.upi_phone || null,
      profile.upi_qr_file_id || null,
      profile.gst_rate ?? 0
    )
    .run();
}

/**
 * Check and record an incoming Telegram update_id to protect against duplicate deliveries.
 * Returns true if the update is new; false if it was already processed.
 *
 * @param {D1Database} db - Cloudflare D1 binding
 * @param {number} updateId - Telegram update_id
 * @returns {Promise<boolean>}
 */
export async function isNewUpdate(db, updateId) {
  if (!db || updateId === undefined || updateId === null) return true;
  const result = await db
    .prepare("INSERT OR IGNORE INTO processed_updates (update_id) VALUES (?)")
    .bind(updateId)
    .run();
  if (Number(updateId) > 0 && Number(updateId) % 1000 === 0) {
    try {
      await db.prepare("DELETE FROM processed_updates WHERE processed_at < datetime('now', '-7 days')").run();
    } catch (err) {
      console.warn("Could not prune old processed update records.", err?.message);
    }
  }
  return Number(result?.meta?.changes || 0) > 0;
}

export async function isUpdateProcessed(db, updateId) {
  if (!db || updateId === undefined || updateId === null) return false;
  const row = await db.prepare("SELECT update_id FROM processed_updates WHERE update_id = ?").bind(updateId).first();
  return Boolean(row);
}

export async function getSubscription(db, telegramId) {
  if (!db) return null;
  return await db
    .prepare("SELECT telegram_id, expires_at FROM subscriptions WHERE telegram_id = ?")
    .bind(String(telegramId))
    .first();
}

export async function hasActiveSubscription(db, telegramId, now = new Date()) {
  const user = await db.prepare("SELECT is_blocked FROM users WHERE telegram_id = ?").bind(String(telegramId)).first();
  if (Number(user?.is_blocked || 0)) return false;
  const subscription = await getSubscription(db, telegramId);
  return Boolean(subscription && new Date(subscription.expires_at).getTime() > now.getTime());
}

export async function getAdminStats(db) {
  const row = await db.prepare(`SELECT
    (SELECT COUNT(*) FROM (SELECT telegram_id FROM users UNION SELECT telegram_id FROM subscriptions UNION SELECT telegram_id FROM payment_requests)) AS total_users,
    (SELECT COUNT(*) FROM subscriptions WHERE expires_at > datetime('now')) AS active_subscriptions,
    (SELECT COUNT(*) FROM subscriptions WHERE expires_at <= datetime('now')) AS expired_subscriptions,
    (SELECT COUNT(*) FROM payment_requests WHERE status = 'pending') AS pending_payments,
    (SELECT COUNT(*) FROM payment_requests WHERE status = 'approved' AND reviewed_at >= datetime('now', 'start of month')) AS monthly_approvals,
    (SELECT COUNT(*) FROM payment_requests WHERE status = 'approved' AND plan = 'monthly' AND reviewed_at >= datetime('now', 'start of month')) AS monthly_plan_approvals,
    (SELECT COUNT(*) FROM payment_requests WHERE status = 'approved' AND plan = 'yearly' AND reviewed_at >= datetime('now', 'start of month')) AS yearly_plan_approvals`).first();
  return row || {};
}

export async function getAdminUsers(db, search = '', limit = 10) {
  const pattern = `%${search}%`;
  const result = await db.prepare(`SELECT all_users.telegram_id, all_users.business_name, COALESCE(all_users.is_blocked,0) AS is_blocked, s.expires_at,
    (SELECT COUNT(*) FROM payment_requests p WHERE p.telegram_id=all_users.telegram_id) AS payment_count
    FROM (SELECT telegram_id, business_name, is_blocked FROM users UNION SELECT telegram_id, NULL, 0 FROM subscriptions) all_users
    LEFT JOIN subscriptions s ON s.telegram_id=all_users.telegram_id
    WHERE (? = '' OR all_users.telegram_id LIKE ? OR COALESCE(all_users.business_name,'') LIKE ?)
    ORDER BY s.expires_at DESC LIMIT ?`).bind(search, pattern, pattern, limit).all();
  return result?.results || [];
}

export async function getPaymentHistory(db, telegramId, limit = 10) {
  const result = await db.prepare(`SELECT id, plan, status, created_at, reviewed_at, reviewed_by FROM payment_requests
    WHERE telegram_id = ? ORDER BY id DESC LIMIT ?`).bind(String(telegramId), limit).all();
  return result?.results || [];
}

export async function setUserBlocked(db, telegramId, blocked) {
  await db.prepare('INSERT OR IGNORE INTO users (telegram_id) VALUES (?)').bind(String(telegramId)).run();
  await db.prepare('UPDATE users SET is_blocked = ? WHERE telegram_id = ?').bind(blocked ? 1 : 0, String(telegramId)).run();
}

export async function createOrUpdatePaymentRequest(db, telegramId, screenshotFileId, plan = "monthly") {
  const id = String(telegramId);
  const pending = await db
    .prepare("SELECT id FROM payment_requests WHERE telegram_id = ? AND status = 'pending'")
    .bind(id)
    .first();
  if (pending) {
    await db
      .prepare("UPDATE payment_requests SET screenshot_file_id = ?, plan = ?, created_at = datetime('now') WHERE id = ?")
      .bind(screenshotFileId, plan, pending.id)
      .run();
    return pending.id;
  }

  try {
    const result = await db
      .prepare("INSERT INTO payment_requests (telegram_id, screenshot_file_id, plan) VALUES (?, ?, ?)")
      .bind(id, screenshotFileId, plan)
      .run();
    return result?.meta?.last_row_id ?? null;
  } catch (err) {
    // A concurrent duplicate submission may win the partial unique index.
    const existing = await db
      .prepare("SELECT id FROM payment_requests WHERE telegram_id = ? AND status = 'pending'")
      .bind(id)
      .first();
    if (!existing) throw err;
    return existing.id;
  }
}

export async function startPaymentSession(db, telegramId, plan) {
  await db.prepare(`INSERT INTO payment_sessions (telegram_id, plan) VALUES (?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET plan = excluded.plan, started_at = datetime('now')`)
    .bind(String(telegramId), plan).run();
}

export async function getPaymentSession(db, telegramId) {
  const row = await db.prepare("SELECT plan FROM payment_sessions WHERE telegram_id = ? AND started_at >= datetime('now', '-1 day')")
    .bind(String(telegramId)).first();
  return row || null;
}

export async function clearPaymentSession(db, telegramId) {
  await db.prepare("DELETE FROM payment_sessions WHERE telegram_id = ?").bind(String(telegramId)).run();
}

export async function extendSubscription(db, telegramId, days = 30, reviewedBy = null, requirePending = false) {
  const id = String(telegramId);
  if (!requirePending && Number(days) === 0) {
    await db.prepare("DELETE FROM subscriptions WHERE telegram_id = ?").bind(id).run();
    return new Date().toISOString();
  }
  let accessDays = days;
  if (requirePending) {
    const pending = await db.prepare("SELECT id, plan FROM payment_requests WHERE telegram_id = ? AND status = 'pending'").bind(id).first();
    if (!pending) return null;
    accessDays = pending.plan === "yearly" ? 365 : 30;
  }
  const now = new Date();
  const current = await getSubscription(db, id);
  const currentExpiry = current ? new Date(current.expires_at) : null;
  const start = currentExpiry && currentExpiry > now ? currentExpiry : now;
  const expiry = new Date(start.getTime() + accessDays * 24 * 60 * 60 * 1000).toISOString();

  const statements = [
    db.prepare(`INSERT INTO subscriptions (telegram_id, expires_at, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(telegram_id) DO UPDATE SET expires_at = excluded.expires_at, updated_at = datetime('now')`)
      .bind(id, expiry),
  ];
  if (requirePending) {
    statements.push(db.prepare(`UPDATE payment_requests SET status = 'approved', screenshot_file_id = '', reviewed_at = datetime('now'), reviewed_by = ?
      WHERE telegram_id = ? AND status = 'pending'`).bind(reviewedBy, id));
  }
  await db.batch(statements);
  return expiry;
}

export async function rejectPaymentRequest(db, telegramId, reviewedBy) {
  const result = await db
    .prepare(`UPDATE payment_requests SET status = 'rejected', screenshot_file_id = '', reviewed_at = datetime('now'), reviewed_by = ?
      WHERE telegram_id = ? AND status = 'pending'`)
    .bind(String(reviewedBy), String(telegramId))
    .run();
  return Number(result?.meta?.changes || 0) > 0;
}

export async function checkD1RateLimit(db, telegramId, limit = 30, windowMs = 60000) {
  const now = Date.now();
  const row = await db.prepare(`
    INSERT INTO rate_limits (telegram_id, window_started_at, request_count) VALUES (?, ?, 1)
    ON CONFLICT(telegram_id) DO UPDATE SET
      window_started_at = CASE WHEN rate_limits.window_started_at <= ? THEN excluded.window_started_at ELSE rate_limits.window_started_at END,
      request_count = CASE WHEN rate_limits.window_started_at <= ? THEN 1 ELSE rate_limits.request_count + 1 END
    RETURNING request_count
  `).bind(String(telegramId), now, now - windowMs, now - windowMs).first();
  return Number(row?.request_count || 0) <= limit;
}

/**
 * Atomically increments the user's invoice counter and returns the next formatted invoice number.
 * E.g. "INV-001", "INV-002"
 *
 * @param {D1Database} db - Cloudflare D1 binding
 * @param {string|number} telegramId - Unique Telegram User ID
 * @returns {Promise<string>} Next invoice number string
 */
export async function getNextInvoiceNumber(db, telegramId) {
  if (!db) return "INV-001";
  const id = String(telegramId);

  // Ensure record exists
  await db
    .prepare("INSERT OR IGNORE INTO users (telegram_id, invoice_counter) VALUES (?, 0)")
    .bind(id)
    .run();

  // Increment counter
  await db
    .prepare("UPDATE users SET invoice_counter = invoice_counter + 1 WHERE telegram_id = ?")
    .bind(id)
    .run();

  const user = await db
    .prepare("SELECT invoice_counter FROM users WHERE telegram_id = ?")
    .bind(id)
    .first();

  const counter = user ? user.invoice_counter : 1;
  const padded = String(counter).padStart(3, "0");
  return `INV-${padded}`;
}

/**
 * Record minimal invoice metadata for /history.
 * Note: Does not store client data or invoice PDF files.
 *
 * @param {D1Database} db
 * @param {object} invoiceData
 * @returns {Promise<object>}
 */
export async function recordInvoiceMetadata(db, invoiceData) {
  if (!db) return null;
  const query = `
    INSERT INTO invoices (
      telegram_id, invoice_number, date, summary, subtotal_paise, gst_paise, grand_total_paise
    ) VALUES (?, ?, ?, ?, ?, ?, ?);
  `;

  return await db
    .prepare(query)
    .bind(
      String(invoiceData.telegram_id),
      invoiceData.invoice_number,
      invoiceData.date,
      invoiceData.summary,
      invoiceData.subtotal_paise,
      invoiceData.gst_paise,
      invoiceData.grand_total_paise
    )
    .run();
}

/**
 * Retrieve the user's recent invoices for /history
 *
 * @param {D1Database} db
 * @param {string|number} telegramId
 * @param {number} [limit=5]
 * @returns {Promise<Array<object>>}
 */
export async function getUserInvoiceHistory(db, telegramId, limit = 5) {
  if (!db) return [];
  const query = `
    SELECT invoice_number, date, summary, subtotal_paise, gst_paise, grand_total_paise, created_at
    FROM invoices
    WHERE telegram_id = ?
    ORDER BY id DESC
    LIMIT ?;
  `;

  const result = await db.prepare(query).bind(String(telegramId), limit).all();
  return result?.results || [];
}
