import { sendTelegramMessage, sendTelegramDocument, getTelegramFileBytes, answerTelegramCallback } from "./telegram.js";
import { mainMenuKeyboard } from "./keyboards.js";
import { parseInvoiceText } from "./parser.js";
import { calculateInvoiceTotals } from "./calculator.js";
import {
  isNewUpdate, isUpdateProcessed, getUserProfile, upsertUserProfile, getNextInvoiceNumber,
  recordInvoiceMetadata, hasActiveSubscription, getSubscription,
  extendSubscription, rejectPaymentRequest,
  getAdminStats, getAdminUsers, getPaymentHistory, setUserBlocked,
  checkD1RateLimit,
} from "./db.js";
import { getProfileView, getPaymentView, getSettingsView, handleProfileUpdate } from "./profile.js";
import { getHistoryView } from "./history.js";
import { generateInvoicePdf } from "./pdf.js";

function getFormattedDate() {
  const d = new Date();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function getAdminIds(env) {
  return String(env.ADMIN_TELEGRAM_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);
}

function getAccessMessage(subscription) {
  if (!subscription) return "This feature requires an active subscription. Please contact the bot administrator.";
  const expiry = new Date(subscription.expires_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  return `Your subscription expired on ${expiry}. Please contact the bot administrator to renew access.`;
}

const adminHome = { inline_keyboard: [
  [{ text: "📊 Stats", callback_data: "admin:stats" }, { text: "👥 Users", callback_data: "admin:users" }],
  [{ text: "🔎 Search user", callback_data: "admin:search" }, { text: "💳 Pending payments", callback_data: "admin:pending" }],
] };

async function showAdminUsers(env, chatId, search = "") {
  const users = await getAdminUsers(env.DB, search, 10);
  if (!users.length) return sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "No users found.", { reply_markup: adminHome });
  for (const user of users) {
    const expiry = user.expires_at ? user.expires_at.slice(0, 10) : "no subscription";
    const label = `${user.business_name || "User"} · ${user.telegram_id} · ${user.is_blocked ? "blocked" : expiry}`;
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, label, { reply_markup: { inline_keyboard: [
      [{ text: user.is_blocked ? "Unblock" : "Block", callback_data: `admin:toggle:${user.telegram_id}` }, { text: "Extend 30 days", callback_data: `admin:extend:${user.telegram_id}` }],
      [{ text: "Yearly (365 days)", callback_data: `admin:yearly:${user.telegram_id}` }, { text: "Custom days", callback_data: `admin:custom:${user.telegram_id}` }],
      [{ text: "Payment history", callback_data: `admin:history:${user.telegram_id}` }],
    ] } });
  }
}

async function handleAdminCallback(env, query) {
  const adminId = String(query.from?.id || "");
  if (!getAdminIds(env).includes(adminId) || query.message?.chat?.type !== "private") {
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, query.id, "Admin access only."); return;
  }
  const chatId = query.message.chat.id;
  const data = String(query.data || "");
  await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, query.id);
  if (data === "admin:stats") {
    const s = await getAdminStats(env.DB);
    const amount = Number(s.monthly_plan_approvals || 0) * Number(env.SUBSCRIPTION_PRICE_MONTHLY_INR || 0)
      + Number(s.yearly_plan_approvals || 0) * Number(env.SUBSCRIPTION_PRICE_YEARLY_INR || 0);
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `📊 <b>BillDost Admin Stats</b>\n\nTotal users: ${s.total_users || 0}\nActive subscriptions: ${s.active_subscriptions || 0}\nExpired subscriptions: ${s.expired_subscriptions || 0}\nPending payments: ${s.pending_payments || 0}\nApproved this month: ${s.monthly_approvals || 0}\nEstimated payments approved this month: ₹${amount}`, { parse_mode: "HTML", reply_markup: adminHome });
  } else if (data === "admin:users") await showAdminUsers(env, chatId);
  else if (data === "admin:search") await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "Send /search followed by a Telegram user ID.");
  else if (data === "admin:pending") {
    const rows = (await env.DB.prepare("SELECT telegram_id, plan, created_at FROM payment_requests WHERE status='pending' ORDER BY created_at").all()).results || [];
    if (!rows.length) await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "No pending payments.", { reply_markup: adminHome });
    for (const row of rows) await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `${row.plan} payment · user ${row.telegram_id} · ${row.created_at}`, { reply_markup: { inline_keyboard: [[{ text: "Approve", callback_data: `admin:approve:${row.telegram_id}` }, { text: "Reject", callback_data: `admin:reject:${row.telegram_id}` }]] } });
  } else {
    const [, action, target] = data.split(":");
    if (!/^\d+$/.test(target || "")) return;
    if (action === "toggle") {
      const user = (await getAdminUsers(env.DB, target, 1))[0];
      await setUserBlocked(env.DB, target, !user?.is_blocked);
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `User ${target} ${user?.is_blocked ? "unblocked" : "blocked"}.`, { reply_markup: adminHome });
    } else if (action === "extend" || action === "activate" || action === "yearly") {
      const days = action === "yearly" ? 365 : 30;
      const expiry = await extendSubscription(env.DB, target, days, adminId);
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `Access for ${target} extended until ${expiry.slice(0, 10)}.`, { reply_markup: adminHome });
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, target, `BillDost access is active until ${new Date(expiry).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}.`);
    } else if (action === "custom") {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `Send /admin_days ${target} <days> with a value from 0 to 365. 0 removes the subscription; 1–365 adds that many days.`);
    } else if (action === "history") {
      const rows = await getPaymentHistory(env.DB, target);
      const history = rows.length ? rows.map((r) => `${r.plan}: ${r.status} · ${r.created_at}`).join("\n") : "No payment history.";
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `Payments for ${target}:\n${history}`, { reply_markup: adminHome });
    } else if (action === "approve") {
      const expiry = await extendSubscription(env.DB, target, 30, adminId, true);
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, expiry ? `Approved ${target} until ${expiry.slice(0, 10)}.` : `No pending payment for ${target}.`, { reply_markup: adminHome });
      if (expiry) await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, target, `Payment approved. BillDost access is active until ${new Date(expiry).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}.`);
    } else if (action === "reject") {
      const rejected = await rejectPaymentRequest(env.DB, target, adminId);
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, rejected ? `Payment from ${target} rejected.` : `No pending payment for ${target}.`, { reply_markup: adminHome });
      if (rejected) await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, target, "Your payment request was not approved. Please contact the bot owner if you think this is a mistake.");
    }
  }
}

async function handleMessage(env, message) {
  if (message.chat?.type !== "private" || !message.from?.id) return;

  const chatId = message.chat.id;
  const telegramId = String(message.from.id);
  const text = (message.text || "").trim();
  const isAdmin = getAdminIds(env).includes(telegramId);

  if (!(await checkD1RateLimit(env.DB, telegramId, 30, 60000))) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "You are sending messages too quickly. Please wait before trying again.");
    return;
  }

  if (/^\/(approve|reject|grant)(?:@\w+)?\b/i.test(text)) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "That admin command has been removed. Use /admin.");
    return;
  }

  if (text === "/admin") {
    if (!isAdmin) await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "Admin access only.");
    else await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "<b>BillDost Admin Panel</b>\nAdmin only", { parse_mode: "HTML", reply_markup: adminHome });
    return;
  }
  const searchMatch = text.match(/^\/search(?:@\w+)?\s+(\d+)$/i);
  if (searchMatch) {
    if (isAdmin) await showAdminUsers(env, chatId, searchMatch[1]);
    else await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "Admin access only.");
    return;
  }
  const broadcastMatch = text.match(/^\/broadcast(?:@\w+)?\s+([\s\S]{1,3500})$/i);
  if (broadcastMatch) {
    if (!isAdmin) await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "Admin access only.");
    else {
      const users = await getAdminUsers(env.DB, "", 10000);
      let sent = 0;
      for (const user of users) {
        if (user.is_blocked) continue;
        try { await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, user.telegram_id, broadcastMatch[1]); sent++; } catch (err) { console.warn(`Broadcast failed for ${user.telegram_id}`, err?.message); }
      }
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `Announcement sent to ${sent} users.`);
    }
    return;
  }

  const daysMatch = text.match(/^\/admin_days(?:@\w+)?\s+(\d+)\s+(\d{1,3})$/i);
  if (/^\/admin_days(?:@\w+)?\b/i.test(text)) {
    if (!isAdmin) await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "Admin access only.");
    else if (!daysMatch || Number(daysMatch[2]) > 365) await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "Usage: /admin_days <telegram_user_id> <0-365>");
    else {
      const [, target, input] = daysMatch;
      const days = Number(input);
      const expiry = await extendSubscription(env.DB, target, days, telegramId);
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, days === 0 ? `Subscription removed for ${target}.` : `Added ${days} days for ${target}; access until ${expiry.slice(0, 10)}.`);
      if (days > 0) await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, target, `BillDost access is active until ${new Date(expiry).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}.`);
      else await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, target, "Your BillDost subscription has ended. Contact the bot administrator for access.");
    }
    return;
  }

  const active = await hasActiveSubscription(env.DB, telegramId);
  const subscription = await getSubscription(env.DB, telegramId);

  if (message.photo?.length) {
    const photo = message.photo[message.photo.length - 1];
    if (active) {
      const profile = (await getUserProfile(env.DB, telegramId)) || { telegram_id: telegramId };
      profile.upi_qr_file_id = photo.file_id;
      await upsertUserProfile(env.DB, profile);
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "Your invoice payment QR image has been saved.", { reply_markup: mainMenuKeyboard });
    } else {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "Please contact the bot administrator to activate access.");
    }
    return;
  }

  if (!message.text) return;

  // These help and renewal routes remain usable before purchase and after expiry.
  if (text === "/start") {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `👋 **Welcome to BillKaro!**

Your simple, smart invoice assistant.

Create professional PDF invoices directly from Telegram. No complicated forms, no spreadsheets, no hassle.

✨ **What you can do with BillKaro:**

🧾 Create invoices using simple text
📄 Generate beautiful PDF invoices
💳 Add your UPI payment QR code
🧮 Automatic calculations and GST
📂 Access your invoice history
⚡ Get your invoice delivered in seconds

**🚀 Getting started**

Before creating your first invoice, let's set up your business details.

**Step 1:** Set up your business profile.
**Step 2:** Add your UPI payment details or QR code.
**Step 3:** Start creating invoices!

Ready to get started?

Send /profile to set up your business.

💚 BillKaro — Billing made simple.`, { reply_markup: mainMenuKeyboard });
    return;
  }
  if (text === "/status") {
    const status = active
      ? `Your subscription is active until ${new Date(subscription.expires_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}.`
      : getAccessMessage(subscription);
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, status);
    return;
  }
  if (text === "/myid") {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `Your Telegram user ID is <code>${telegramId}</code>.`, { parse_mode: "HTML" });
    return;
  }
  if (text === "/help" || text === "❓ Help") {
    const helpText = `📖 <b>BILLKARO — QUICK START GUIDE</b>

Create professional PDF invoices directly from Telegram. Here's how to use BillKaro.

━━━━━━━━━━━━━━━━━━

🧾 <b>1. CREATE AN INVOICE</b>

Simply type your items, quantities and prices.

<b>Single item:</b>
<code>Web Design 1500</code>

Quantity automatically defaults to 1.

<b>Multiple items:</b>
<code>Banana 2 50
Apple 3 120
Orange 1 80</code>

BillKaro automatically calculates item totals, subtotal and grand total.

📄 Your professional PDF invoice will be generated and sent directly to your chat.

━━━━━━━━━━━━━━━━━━

👤 <b>2. BUSINESS PROFILE</b>

Use /profile to configure your invoice details.

• Business name
• Your name
• Phone number
• Business address
• GSTIN (optional)

Your business details automatically appear on invoices.

━━━━━━━━━━━━━━━━━━

💳 <b>3. PAYMENT DETAILS</b>

Use /payment to configure your payment information.

• Add your UPI ID.
• Upload your PhonePe, Google Pay or Paytm QR code.

Your payment details will appear on generated invoices, making it easier for customers to pay you.

━━━━━━━━━━━━━━━━━━

🧮 <b>4. GST SETTINGS</b>

Use /tax to configure GST.

Supported rates: 0%, 5%, 12%, 18% and 28%.

• CGST + SGST
• IGST

GST is optional. You can also generate invoices without GST.

━━━━━━━━━━━━━━━━━━

📂 <b>5. INVOICE HISTORY</b>

Use /history to access your invoice history and review your previous billing activity.

━━━━━━━━━━━━━━━━━━

⚡ <b>QUICK COMMANDS</b>

/invoice — Create an invoice
/history — View invoice history
/profile — Manage business details
/payment — Manage UPI and QR code
/tax — Manage GST settings
/help — View this guide

━━━━━━━━━━━━━━━━━━

💡 <b>IMPORTANT TIPS</b>

• No forms required to add invoice items.
• Quantity defaults to 1 when omitted.
• Add multiple items using separate lines.
• Configure your business profile before creating your first invoice.
• Upload your QR code once to reuse it on future invoices.

<b>BillKaro — Billing made simple. 💚</b>`;
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, helpText, { parse_mode: "HTML", reply_markup: mainMenuKeyboard });
    return;
  }

  if (text.startsWith("/set_") || text.startsWith("/clear_")) {
    const spaceIndex = text.indexOf(" ");
    const command = spaceIndex > 0 ? text.slice(0, spaceIndex) : text;
    const argument = spaceIndex > 0 ? text.slice(spaceIndex + 1) : "";
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, await handleProfileUpdate(env.DB, telegramId, command, argument), { parse_mode: "HTML", reply_markup: mainMenuKeyboard });
    return;
  }

  if (!active) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, getAccessMessage(subscription));
    return;
  }

  if (text === "/history" || text === "📋 My Invoices") {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, await getHistoryView(env.DB, telegramId), { parse_mode: "HTML", reply_markup: mainMenuKeyboard });
  } else if (text === "/profile" || text === "👤 Business Profile") {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `${await getProfileView(env.DB, telegramId)} \n\n <b>Copy this and paste it:</b>  /set_name · /set_address · /set_phone · /set_email · /set_gstin · /set_upi  \n\n<b>Clear saved fields:</b> /clear_name · /clear_address · /clear_phone · /clear_email · /clear_gstin · /clear_upi ` , { parse_mode: "HTML", reply_markup: mainMenuKeyboard });
  } else if (text === "/payment" || text === "💳 Payment Settings") {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `${await getPaymentView(env.DB, telegramId)}\n\nCopy this and paste it: /set_upi · /set_upiphone · /set_qr\n\nClear with: /clear_upi · /clear_upiphone · /clear_qr`, { parse_mode: "HTML", reply_markup: mainMenuKeyboard });
  } else if (text === "/tax" || text === "Tax & GST") {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `${await getSettingsView(env.DB, telegramId)}\n\nUse /clear_gst to reset the rate to 0%.`, { parse_mode: "HTML", reply_markup: mainMenuKeyboard });
  } else if (text.startsWith("/set_")) {
    const spaceIndex = text.indexOf(" ");
    const command = spaceIndex > 0 ? text.slice(0, spaceIndex) : text;
    const argument = spaceIndex > 0 ? text.slice(spaceIndex + 1) : "";
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, await handleProfileUpdate(env.DB, telegramId, command, argument), { parse_mode: "HTML", reply_markup: mainMenuKeyboard });
  } else if (text === "/invoice" || text === "📝 Create Invoice") {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "Ready to create an invoice. Send items and prices, one per line. Example:\napple 499\nbanana 2 50", { reply_markup: mainMenuKeyboard });
  } else {
    const parsed = parseInvoiceText(text);
    if (!parsed.success) {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `Could not read invoice items:\n${parsed.errors.map((error) => `• ${error}`).join("\n")}\n\nExample: apple 499`, { parse_mode: "HTML", reply_markup: mainMenuKeyboard });
      return;
    }

    const profile = await getUserProfile(env.DB, telegramId);
    const totals = calculateInvoiceTotals(parsed.items, { gstRate: profile?.gst_rate || 0 });
    const invoiceNumber = await getNextInvoiceNumber(env.DB, telegramId);
    const invoiceDate = getFormattedDate();
    let qrImageBytes = null;
    if (profile?.upi_qr_file_id) qrImageBytes = await getTelegramFileBytes(env.TELEGRAM_BOT_TOKEN, profile.upi_qr_file_id);
    const pdfBytes = await generateInvoicePdf({ invoiceNumber, date: invoiceDate, profile: profile || {}, items: parsed.items, totals, qrImageBytes });
    const summary = parsed.items.map((item) => item.description).join(", ").slice(0, 200);
    await recordInvoiceMetadata(env.DB, {
      telegram_id: telegramId, invoice_number: invoiceNumber, date: invoiceDate, summary,
      subtotal_paise: totals.subtotalPaise, gst_paise: totals.gstPaise, grand_total_paise: totals.grandTotalPaise,
    });
    const caption = `Invoice ${invoiceNumber} generated.\nTotal: ${totals.formatted.grandTotal}`;
    await sendTelegramDocument(env.TELEGRAM_BOT_TOKEN, chatId, pdfBytes, `Invoice_${invoiceNumber}.pdf`, caption);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("BillDost Bot Worker is active and healthy!", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (request.method !== "POST" || url.pathname !== "/webhook") return new Response("Not Found", { status: 404 });

    const configuredSecret = env.TELEGRAM_SECRET_TOKEN;
    if (!configuredSecret) return new Response("Webhook is not configured", { status: 503 });
    if (request.headers.get("x-telegram-bot-api-secret-token") !== configuredSecret) return new Response("Unauthorized", { status: 401 });
    if (!env.DB || !env.TELEGRAM_BOT_TOKEN) return new Response("Bot is not configured", { status: 503 });

    try {
      const update = await request.json();
      if (update.update_id !== undefined && await isUpdateProcessed(env.DB, update.update_id)) {
        return new Response("OK", { status: 200 });
      }
      if (update.message) await handleMessage(env, update.message);
      if (update.callback_query) {
        if (String(update.callback_query.data || "").startsWith("admin:")) await handleAdminCallback(env, update.callback_query);
        else await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, update.callback_query.id, "This option is no longer available.");
      }
      // Record only after handling succeeds so Telegram retries can recover transient failures.
      if (update.update_id !== undefined) await isNewUpdate(env.DB, update.update_id);
      return new Response("OK", { status: 200 });
    } catch (err) {
      console.error("Error processing Telegram update:", err);
      return new Response("Temporary processing error", { status: 500 });
    }
  },
};
