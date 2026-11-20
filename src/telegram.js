/**
 * Helper to interact with the Telegram Bot API
 */

/**
 * Send a message to a Telegram chat.
 *
 * @param {string} botToken - The Telegram bot token
 * @param {number|string} chatId - Recipient chat/user ID
 * @param {string} text - Message text
 * @param {object} [extraParams={}] - Optional parameters (e.g., parse_mode, reply_markup)
 * @returns {Promise<object|null>} Telegram API response or null on error
 */
export async function sendTelegramMessage(botToken, chatId, text, extraParams = {}) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        ...extraParams,
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      console.error("Telegram API error:", data);
    }
    return data;
  } catch (err) {
    console.error("Failed to reach Telegram API:", err.message);
    return null;
  }
}

/**
 * Retrieve the binary bytes (ArrayBuffer) of a file from Telegram's CDN.
 *
 * @param {string} botToken - Telegram Bot Token
 * @param {string} fileId - Telegram file_id
 * @returns {Promise<ArrayBuffer|null>} Binary data of the file
 */
export async function getTelegramFileBytes(botToken, fileId) {
  if (!botToken || !fileId) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const data = await res.json();
    if (!data.ok || !data.result.file_path) return null;

    const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${data.result.file_path}`;
    const fileRes = await fetch(downloadUrl);
    return await fileRes.arrayBuffer();
  } catch (err) {
    console.error("Error downloading file from Telegram:", err.message);
    return null;
  }
}

/**
 * Send a document (e.g. PDF invoice) to a Telegram chat using multipart/form-data.
 *
 * @param {string} botToken - Telegram Bot Token
 * @param {number|string} chatId - Target chat ID
 * @param {Uint8Array} fileBytes - Binary PDF bytes
 * @param {string} fileName - e.g. "Invoice_INV-001.pdf"
 * @param {string} [caption=""] - Optional caption text
 * @returns {Promise<object|null>}
 */
export async function sendTelegramDocument(botToken, chatId, fileBytes, fileName, caption = "") {
  const url = `https://api.telegram.org/bot${botToken}/sendDocument`;

  try {
    const formData = new FormData();
    formData.append("chat_id", String(chatId));
    formData.append(
      "document",
      new Blob([fileBytes], { type: "application/pdf" }),
      fileName
    );
    if (caption) {
      formData.append("caption", caption);
      formData.append("parse_mode", "HTML");
    }

    const response = await fetch(url, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    if (!data.ok) {
      console.error("Telegram sendDocument error:", data);
    }
    return data;
  } catch (err) {
    console.error("Failed to send document to Telegram:", err.message);
    return null;
  }
}

export async function forwardTelegramMessage(botToken, targetChatId, sourceChatId, messageId) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/forwardMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: targetChatId, from_chat_id: sourceChatId, message_id: messageId }),
    });
    const data = await response.json();
    if (!data.ok) console.error("Telegram forwardMessage error:", data);
    return data;
  } catch (err) {
    console.error("Failed to forward Telegram message:", err.message);
    return null;
  }
}

export async function sendTelegramPhoto(botToken, chatId, photo, caption = "") {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, photo, caption }),
    });
    const data = await response.json();
    if (!data.ok) console.error("Telegram sendPhoto error:", data);
    return data;
  } catch (err) {
    console.error("Failed to send Telegram photo:", err.message);
    return null;
  }
}

export async function answerTelegramCallback(botToken, callbackQueryId, text = "") {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
    const data = await response.json();
    if (!data.ok) console.error("Telegram answerCallbackQuery error:", data);
    return data;
  } catch (err) {
    console.error("Failed to answer Telegram callback:", err.message);
    return null;
  }
}
