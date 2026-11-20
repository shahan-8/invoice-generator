import { getUserInvoiceHistory } from "./db.js";
import { formatINR } from "./calculator.js";

/**
 * Render the HTML text for the User's Invoice History view
 *
 * @param {D1Database} db
 * @param {string|number} telegramId
 * @returns {Promise<string>}
 */
export async function getHistoryView(db, telegramId) {
  const invoices = await getUserInvoiceHistory(db, telegramId, 5);

  if (!invoices || invoices.length === 0) {
    return (
      `📋 <b>Your Invoice History:</b>\n\n` +
      `You haven't generated any invoices yet.\n\n` +
      `<i>To create your first invoice, just send your items and prices:</i>\n` +
      `<code>Web Design 5000\nLogo Design 2 1500</code>`
    );
  }

  let text = `📋 <b>Your Recent Invoices (Last ${invoices.length}):</b>\n\n`;

  for (const inv of invoices) {
    const totalFormatted = formatINR(inv.grand_total_paise);
    text +=
      `🧾 <b>${inv.invoice_number}</b> (${inv.date})\n` +
      `• Items: <i>${inv.summary}</i>\n` +
      `• Amount: <b>${totalFormatted}</b>\n\n`;
  }

  text += `<i>Full PDF invoices are delivered directly in this chat upon creation.</i>`;
  return text;
}

