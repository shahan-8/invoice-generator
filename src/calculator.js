/**
 * Financial Calculation & Formatting Module for BillDost
 * All arithmetic is performed in integer paise (1 INR = 100 paise)
 * to avoid IEEE 754 floating-point rounding errors.
 */

/**
 * Format integer paise into an Indian Rupee string (₹).
 * Uses Indian numbering grouping (e.g. 1,00,000.00).
 *
 * @param {number} paise - Amount in integer paise
 * @returns {string} Formatted currency string, e.g. "₹1,23,456.78"
 */
export function formatINR(paise) {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Validates the 15-character format of an Indian GSTIN.
 * Note: This confirms structural validity (State code + PAN + entity code + Z + check digit),
 * but does not verify real-time registration status with the government portal.
 *
 * @param {string} gstin - GSTIN string to validate
 * @returns {boolean} True if format is valid
 */
export function validateGSTIN(gstin) {
  if (!gstin || typeof gstin !== "string") return false;
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return gstinRegex.test(gstin.trim().toUpperCase());
}

/**
 * Calculate totals, GST breakdowns, and grand total for invoice items.
 *
 * @param {Array<{totalPaise: number}>} items - Parsed invoice items
 * @param {object} options
 * @param {number} [options.gstRate=0] - GST percentage (e.g., 0, 5, 12, 18, 28)
 * @param {boolean} [options.isInclusive=false] - Whether prices already include GST
 * @param {boolean} [options.isInterState=false] - True for IGST, False for CGST + SGST
 * @returns {object} Calculated totals in paise and formatted strings
 */
export function calculateInvoiceTotals(items, options = {}) {
  const gstRate = Number(options.gstRate) || 0;
  const isInclusive = Boolean(options.isInclusive);
  const isInterState = Boolean(options.isInterState);

  // Sum of raw item amounts in paise
  const rawTotalPaise = items.reduce((sum, item) => sum + item.totalPaise, 0);

  let subtotalPaise = 0;
  let gstPaise = 0;
  let grandTotalPaise = 0;

  if (gstRate <= 0) {
    // No GST
    subtotalPaise = rawTotalPaise;
    gstPaise = 0;
    grandTotalPaise = rawTotalPaise;
  } else if (isInclusive) {
    // Inclusive: prices include GST
    grandTotalPaise = rawTotalPaise;
    // subtotal = grandTotal / (1 + rate / 100)
    subtotalPaise = Math.round(grandTotalPaise / (1 + gstRate / 100));
    gstPaise = grandTotalPaise - subtotalPaise;
  } else {
    // Exclusive: GST added on top of subtotal
    subtotalPaise = rawTotalPaise;
    gstPaise = Math.round((subtotalPaise * gstRate) / 100);
    grandTotalPaise = subtotalPaise + gstPaise;
  }

  // Tax breakdown (CGST + SGST vs IGST)
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;

  if (gstPaise > 0) {
    if (isInterState) {
      igstPaise = gstPaise;
    } else {
      // Split evenly into CGST and SGST
      cgstPaise = Math.floor(gstPaise / 2);
      sgstPaise = gstPaise - cgstPaise; // Handles odd paise difference safely
    }
  }

  return {
    rawTotalPaise,
    subtotalPaise,
    gstPaise,
    grandTotalPaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    gstRate,
    isInclusive,
    isInterState,
    formatted: {
      subtotal: formatINR(subtotalPaise),
      gst: formatINR(gstPaise),
      grandTotal: formatINR(grandTotalPaise),
      cgst: formatINR(cgstPaise),
      sgst: formatINR(sgstPaise),
      igst: formatINR(igstPaise),
    },
  };
}

