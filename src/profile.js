import { getUserProfile, upsertUserProfile } from "./db.js";
import { validateGSTIN } from "./calculator.js";


/**
 * Validate standard Indian UPI ID format (e.g. name@bank, phone@paytm)
 * @param {string} upi
 * @returns {boolean}
 */
export function validateUPI(upi) {
  if (!upi || typeof upi !== "string") return false;
  const upiRegex = /^[\w.\-_]{2,256}@[a-zA-Z]{2,64}$/;
  return upiRegex.test(upi.trim());
}

/**
 * Render the HTML text for the Business Profile view
 */
export async function getProfileView(db, telegramId) {
  const user = (await getUserProfile(db, telegramId)) || {};
  return (
    `👤 <b>Your Business Profile:</b>\n\n` +
    `• <b>Business Name:</b> ${user.business_name || "<i>Not set</i>"}\n` +
    `• <b>Address:</b> ${user.business_address || "<i>Not set</i>"}\n` +
    `• <b>Phone:</b> ${user.phone || "<i>Not set</i>"}\n` +
    `• <b>Email:</b> ${user.email || "<i>Not set</i>"}\n` +
    `• <b>GSTIN:</b> ${user.gstin ? `<code>${user.gstin}</code>` : "<i>Not set</i>"}\n` +
    `• <b>UPI ID:</b> ${user.upi_id ? `<code>${user.upi_id}</code>` : "<i>Not set</i>"}\n\n` +
    `<b>To update any detail, send:</b>\n` +
    `• <code>/set_name Apex Studio</code>\n` +
    `• <code>/set_address 123 MG Road, Bengaluru</code>\n` +
    `• <code>/set_phone +91 9876543210</code> · remove with <code>/clear_phone</code>\n` +
    `• <code>/set_email rahul@apex.in</code>\n` +
    `• <code>/set_gstin 27AAAAA0000A1Z5</code>\n` +
    `• <code>/set_upi apex@upi</code>`
  );
}

/**
 * Render the HTML text for Payment Settings
 */
export async function getPaymentView(db, telegramId) {
  const user = (await getUserProfile(db, telegramId)) || {};
  const hasQrImage = Boolean(user.upi_qr_file_id);

  return (
    `💳 <b>Payment Configuration:</b>\n\n` +
    `• <b>UPI ID:</b> ${user.upi_id ? `<code>${user.upi_id}</code>` : "<i>Not set</i>"}\n` +
    `• <b>UPI Phone:</b> ${user.upi_phone ? `<code>${user.upi_phone}</code>` : "<i>Not set</i>"}\n` +
    `• <b>QR Code Image:</b> ${
      hasQrImage
        ? "✅ <b>Uploaded</b> <i>(send another photo anytime to update)</i>"
        : "❌ <i>Not uploaded (send a photo of your QR code to upload it!)</i>"
    }\n\n` +
    `<b>How to set your payment details:</b>\n` +
    `1. <b>Send your UPI ID:</b> <code>/set_upi yourname@bank</code>\n` +
    `2. <b>Upload QR code:</b> Simply send a photo of your PhonePe/GPay/Paytm QR code in this chat!\n` +
    `3. <b>Optional Phone:</b> <code>/set_upiphone 9876543210</code> · remove with <code>/clear_upiphone</code>`
  );
}

/**
 * Render the HTML text for Settings (GST and preferences)
 */
export async function getSettingsView(db, telegramId) {
  const user = (await getUserProfile(db, telegramId)) || {};
  const rate = user.gst_rate ?? 0;
  return (
    `⚙️ <b>Tax & Invoice Settings:</b>\n\n` +
    `• <b>Default GST Rate:</b> ${rate}% ${rate > 0 ? "(Active)" : "(Disabled)"}\n` +
    `• <b>Invoices Generated:</b> ${user.invoice_counter || 0}\n\n` +
    `<b>To change your default GST rate, send:</b>\n` +
    `• <code>/set_gst 0</code> (No GST / Unregistered)\n` +
    `• <code>/set_gst 5</code> (5% GST)\n` +
    `• <code>/set_gst 12</code> (12% GST)\n` +
    `• <code>/set_gst 18</code> (18% GST - standard services)\n` +
    `• <code>/set_gst 28</code> (28% GST)`
  );
}

/**
 * Process a profile or settings update command
 *
 * @param {D1Database} db
 * @param {string|number} telegramId
 * @param {string} command - e.g. "/set_name"
 * @param {string} argument - e.g. "Acme Design Co."
 * @returns {Promise<string>} HTML response message
 */
export async function handleProfileUpdate(db, telegramId, command, argument) {
  if (command.startsWith("/clear_")) {
    const fields = { phone: "phone", upiphone: "upi_phone", name: "business_name", address: "business_address", email: "email", gstin: "gstin", upi: "upi_id", qr: "upi_qr_file_id", gst: "gst_rate" };
    const field = fields[command.slice(7)];
    if (!field) return "Unknown profile field.";
    const profile = (await getUserProfile(db, telegramId)) || { telegram_id: telegramId };
    profile[field] = field === "gst_rate" ? 0 : null;
    await upsertUserProfile(db, profile);
    return `✅ ${field === "phone" || field === "upi_phone" ? "Phone" : "Profile field"} cleared.`;
  }
  if (!argument || !argument.trim()) {
    return `⚠️ Please provide a value. Example: <code>${command} My Value</code>`;
  }

  const value = argument.trim();
  const existing = (await getUserProfile(db, telegramId)) || { telegram_id: telegramId };

  switch (command) {
    case "/set_name":
      existing.business_name = value;
      await upsertUserProfile(db, existing);
      return `✅ Business name updated to: <b>${value}</b>`;

    case "/set_address":
      existing.business_address = value;
      await upsertUserProfile(db, existing);
      return `✅ Business address updated to: <b>${value}</b>`;

    case "/set_phone":
      existing.phone = value;
      await upsertUserProfile(db, existing);
      return `✅ Business phone updated to: <b>${value}</b>`;

    case "/set_email":
      if (!value.includes("@") || !value.includes(".")) {
        return `⚠️ Please provide a valid email address (e.g. <code>/set_email rahul@example.com</code>).`;
      }
      existing.email = value.toLowerCase();
      await upsertUserProfile(db, existing);
      return `✅ Business email updated to: <b>${existing.email}</b>`;

    case "/set_gstin": {
      const cleanGstin = value.toUpperCase();
      if (!validateGSTIN(cleanGstin)) {
        return (
          `⚠️ <b>Invalid GSTIN format.</b>\n` +
          `A valid Indian GSTIN must be 15 characters (e.g. <code>27AAAAA0000A1Z5</code>).\n` +
          `<i>Note: Only format validation is checked; verification with the tax portal is separate.</i>`
        );
      }
      existing.gstin = cleanGstin;
      await upsertUserProfile(db, existing);
      return `✅ GSTIN updated to: <code>${cleanGstin}</code>`;
    }

    case "/set_upi": {
      if (!validateUPI(value)) {
        return (
          `⚠️ <b>Invalid UPI ID format.</b>\n` +
          `A valid UPI ID looks like <code>username@bank</code> or <code>phone@paytm</code>.`
        );
      }
      existing.upi_id = value.toLowerCase();
      await upsertUserProfile(db, existing);
      return `✅ UPI ID updated to: <code>${existing.upi_id}</code>`;
    }

    case "/set_upiphone":
      existing.upi_phone = value;
      await upsertUserProfile(db, existing);
      return `✅ UPI Phone updated to: <b>${value}</b>`;

    case "/set_gst": {
      const rate = parseInt(value, 10);
      const allowedRates = [0, 5, 12, 18, 28];
      if (isNaN(rate) || !allowedRates.includes(rate)) {
        return `⚠️ Invalid GST rate. Allowed rates: <b>0, 5, 12, 18, 28</b>. Example: <code>/set_gst 18</code>`;
      }
      existing.gst_rate = rate;
      await upsertUserProfile(db, existing);
      return `✅ Default GST rate updated to: <b>${rate}%</b>`;
    }

    default:
      return `❓ Unknown command. Send /help for instructions.`;
  }
}

