import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { formatINR } from "./calculator.js";

/**
 * Generate a professional, minimalist PDF Invoice using pdf-lib
 *
 * @param {object} params
 * @param {string} params.invoiceNumber - e.g. "INV-001"
 * @param {string} params.date - e.g. "19 Nov 2026"
 * @param {object} params.profile - Freelancer business details
 * @param {Array<object>} params.items - Parsed items
 * @param {object} params.totals - Calculated financial totals
 * @param {ArrayBuffer|null} [params.qrImageBytes=null] - Optional uploaded QR code bytes
 * @returns {Promise<Uint8Array>}
 */
export async function generateInvoicePdf({
  invoiceNumber,
  date,
  profile = {},
  items = [],
  totals,
  qrImageBytes = null,
}) {
  const pdfDoc = await PDFDocument.create();
  // Standard A4 dimensions (595.28 x 841.89 points)
  const page = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Brand colors
  const primaryColor = rgb(0.1, 0.15, 0.25); // Dark Slate
  const textColor = rgb(0.2, 0.2, 0.2); // Charcoal
  const mutedColor = rgb(0.5, 0.5, 0.5); // Gray
  const lightBg = rgb(0.96, 0.97, 0.98); // Light gray highlight
  const accentColor = rgb(0.12, 0.45, 0.9); // Accent blue

  const margin = 40;
  const rightEdge = width - margin - 15; // Universal right alignment reference
  let cursorY = height - margin;

  // 1. Header: Business Name & "TAX INVOICE" label
  const businessName = (profile.business_name || "FREELANCE SERVICES").toUpperCase();
  page.drawText(businessName, {
    x: margin,
    y: cursorY - 14,
    size: 16,
    font: fontBold,
    color: primaryColor,
  });

  page.drawText(totals.gstPaise > 0 ? "TAX INVOICE" : "INVOICE", {
    x: width - margin - 110,
    y: cursorY - 14,
    size: 18,
    font: fontBold,
    color: accentColor,
  });

  cursorY -= 40;

  // 2. Freelancer Meta (Left) & Invoice Meta (Right)
  let infoY = cursorY;
  if (profile.business_address) {
    page.drawText(profile.business_address, { x: margin, y: infoY, size: 9, font: fontRegular, color: textColor });
    infoY -= 13;
  }
  if (profile.phone) {
    page.drawText(`Phone: ${profile.phone}`, { x: margin, y: infoY, size: 9, font: fontRegular, color: textColor });
    infoY -= 13;
  }
  if (profile.email) {
    page.drawText(`Email: ${profile.email}`, { x: margin, y: infoY, size: 9, font: fontRegular, color: textColor });
    infoY -= 13;
  }
  if (profile.gstin) {
    page.drawText(`GSTIN: ${profile.gstin}`, { x: margin, y: infoY, size: 9, font: fontBold, color: textColor });
    infoY -= 13;
  }

  // Right: Invoice Number & Date
  const metaRightX = width - margin - 150;
  page.drawText(`Invoice No:`, { x: metaRightX, y: cursorY, size: 9, font: fontBold, color: mutedColor });
  page.drawText(invoiceNumber, { x: metaRightX + 65, y: cursorY, size: 10, font: fontBold, color: primaryColor });

  page.drawText(`Date:`, { x: metaRightX, y: cursorY - 14, size: 9, font: fontBold, color: mutedColor });
  page.drawText(date, { x: metaRightX + 65, y: cursorY - 14, size: 9, font: fontRegular, color: textColor });

  cursorY = Math.min(infoY, cursorY - 35) - 20;

  // Horizontal separator line
  page.drawLine({
    start: { x: margin, y: cursorY },
    end: { x: width - margin, y: cursorY },
    thickness: 1,
    color: rgb(0.9, 0.9, 0.9),
  });

  cursorY -= 25;

  // 3. Item Table
  const tableWidth = width - margin * 2;
  const colX = {
    desc: margin + 10,
    qty: margin + 310,
    rate: margin + 375,
  };

  // Header Box
  page.drawRectangle({
    x: margin,
    y: cursorY - 5,
    width: tableWidth,
    height: 22,
    color: lightBg,
  });

  page.drawText("DESCRIPTION", { x: colX.desc, y: cursorY + 2, size: 9, font: fontBold, color: primaryColor });
  page.drawText("QTY", { x: colX.qty, y: cursorY + 2, size: 9, font: fontBold, color: primaryColor });
  page.drawText("UNIT PRICE", { x: colX.rate, y: cursorY + 2, size: 9, font: fontBold, color: primaryColor });

  const totalColHeaderWidth = fontBold.widthOfTextAtSize("TOTAL", 9);
  page.drawText("TOTAL", {
    x: rightEdge - totalColHeaderWidth,
    y: cursorY + 2,
    size: 9,
    font: fontBold,
    color: primaryColor,
  });

  cursorY -= 24;

  // Table Rows
  for (const item of items) {
    const itemTotalStr = `INR ${(item.totalPaise / 100).toFixed(2)}`;
    const unitPriceStr = `INR ${(item.unitPricePaise / 100).toFixed(2)}`;

    page.drawText(item.description, { x: colX.desc, y: cursorY, size: 9, font: fontRegular, color: textColor });
    page.drawText(String(item.quantity), { x: colX.qty + 5, y: cursorY, size: 9, font: fontRegular, color: textColor });
    page.drawText(unitPriceStr, { x: colX.rate, y: cursorY, size: 9, font: fontRegular, color: textColor });

    const totalWidth = fontBold.widthOfTextAtSize(itemTotalStr, 9);
    page.drawText(itemTotalStr, {
      x: rightEdge - totalWidth,
      y: cursorY,
      size: 9,
      font: fontBold,
      color: textColor,
    });

    cursorY -= 12;
    // Row underline
    page.drawLine({
      start: { x: margin, y: cursorY },
      end: { x: width - margin, y: cursorY },
      thickness: 0.5,
      color: rgb(0.93, 0.93, 0.93),
    });
    cursorY -= 14;
  }

  // 4. Totals & Tax Calculation Breakdown (Clean Spacing & Pixel-Perfect Alignment)
  cursorY -= 15;
  const totalsBoxX = width - margin - 220;

  // Subtotal Row
  page.drawText("Subtotal:", { x: totalsBoxX, y: cursorY, size: 9, font: fontRegular, color: mutedColor });
  const subtotalStr = `INR ${(totals.subtotalPaise / 100).toFixed(2)}`;
  const subtotalWidth = fontRegular.widthOfTextAtSize(subtotalStr, 9);
  page.drawText(subtotalStr, {
    x: rightEdge - subtotalWidth,
    y: cursorY,
    size: 9,
    font: fontRegular,
    color: textColor,
  });
  cursorY -= 18;

  // Optional GST Breakdown
  if (totals.gstPaise > 0) {
    if (totals.isInterState) {
      page.drawText(`IGST (${totals.gstRate}%):`, { x: totalsBoxX, y: cursorY, size: 9, font: fontRegular, color: mutedColor });
      const igstStr = `INR ${(totals.igstPaise / 100).toFixed(2)}`;
      const igstWidth = fontRegular.widthOfTextAtSize(igstStr, 9);
      page.drawText(igstStr, { x: rightEdge - igstWidth, y: cursorY, size: 9, font: fontRegular, color: textColor });
      cursorY -= 18;
    } else {
      const halfRate = totals.gstRate / 2;
      page.drawText(`CGST (${halfRate}%):`, { x: totalsBoxX, y: cursorY, size: 9, font: fontRegular, color: mutedColor });
      const cgstStr = `INR ${(totals.cgstPaise / 100).toFixed(2)}`;
      const cgstWidth = fontRegular.widthOfTextAtSize(cgstStr, 9);
      page.drawText(cgstStr, { x: rightEdge - cgstWidth, y: cursorY, size: 9, font: fontRegular, color: textColor });
      cursorY -= 18;

      page.drawText(`SGST (${halfRate}%):`, { x: totalsBoxX, y: cursorY, size: 9, font: fontRegular, color: mutedColor });
      const sgstStr = `INR ${(totals.sgstPaise / 100).toFixed(2)}`;
      const sgstWidth = fontRegular.widthOfTextAtSize(sgstStr, 9);
      page.drawText(sgstStr, { x: rightEdge - sgstWidth, y: cursorY, size: 9, font: fontRegular, color: textColor });
      cursorY -= 18;
    }
  }

  // Clear vertical margin before Grand Total highlight box (prevents any overlap)
  cursorY -= 10;
  const grandTotalBoxHeight = 28;
  const grandTotalBoxY = cursorY - 9;

  // Grand Total Highlight Box
  page.drawRectangle({
    x: totalsBoxX - 10,
    y: grandTotalBoxY,
    width: width - margin - (totalsBoxX - 10),
    height: grandTotalBoxHeight,
    color: lightBg,
  });

  page.drawText("GRAND TOTAL:", {
    x: totalsBoxX,
    y: cursorY,
    size: 10,
    font: fontBold,
    color: primaryColor,
  });

  const grandTotalStr = `INR ${(totals.grandTotalPaise / 100).toFixed(2)}`;
  const grandTotalWidth = fontBold.widthOfTextAtSize(grandTotalStr, 11);
  page.drawText(grandTotalStr, {
    x: rightEdge - grandTotalWidth,
    y: cursorY,
    size: 11,
    font: fontBold,
    color: accentColor,
  });

  // 5. Payment Details & Embedded QR Code (Bottom Section)
  const bottomBoxY = 70;
  const payBoxWidth = width - margin * 2;

  page.drawRectangle({
    x: margin,
    y: bottomBoxY,
    width: payBoxWidth,
    height: 120,
    borderColor: rgb(0.88, 0.88, 0.88),
    borderWidth: 1,
    color: rgb(0.99, 0.99, 0.99),
  });

  page.drawText("PAYMENT INFORMATION", {
    x: margin + 15,
    y: bottomBoxY + 98,
    size: 10,
    font: fontBold,
    color: primaryColor,
  });

  const payInfoY = bottomBoxY + 75;
  if (profile.upi_id) {
    page.drawText("UPI ID:", { x: margin + 15, y: payInfoY, size: 9, font: fontBold, color: mutedColor });
    page.drawText(profile.upi_id, { x: margin + 70, y: payInfoY, size: 10, font: fontBold, color: accentColor });
  }

  if (profile.business_name) {
    page.drawText("Payee:", { x: margin + 15, y: payInfoY - 16, size: 9, font: fontBold, color: mutedColor });
    page.drawText(profile.business_name, { x: margin + 70, y: payInfoY - 16, size: 9, font: fontRegular, color: textColor });
  }

  page.drawText("Scan & pay using any UPI app (GPay, PhonePe, Paytm)", {
    x: margin + 15,
    y: payInfoY - 36,
    size: 8,
    font: fontRegular,
    color: mutedColor,
  });

  // Embed QR Image if provided (Right side of payment box)
  if (qrImageBytes) {
    try {
      let embeddedImage;
      try {
        embeddedImage = await pdfDoc.embedJpg(qrImageBytes);
      } catch (e) {
        embeddedImage = await pdfDoc.embedPng(qrImageBytes);
      }

      const qrDim = 95;
      page.drawImage(embeddedImage, {
        x: width - margin - qrDim - 15,
        y: bottomBoxY + 12,
        width: qrDim,
        height: qrDim,
      });
    } catch (err) {
      console.error("Failed to embed QR image:", err.message);
    }
  }

  // Footer Note
  page.drawText("Thank you for your business! Generated via BillDost.", {
    x: margin,
    y: 35,
    size: 8,
    font: fontRegular,
    color: mutedColor,
  });

  return await pdfDoc.save();
}
