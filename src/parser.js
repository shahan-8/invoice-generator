/**
 * Text Invoice Parser for BillDost
 * Parses free-form user text into structured invoice items.
 */

/**
 * Parse multi-line invoice text into structured items.
 *
 * Rules:
 * - Blank lines are ignored.
 * - 1 trailing number: Quantity defaults to 1, number is unit price.
 * - 2 trailing numbers: First is quantity, second is unit price.
 * - Everything before the numeric fields is the item description.
 * - Decimals are supported for both prices and quantities.
 * - Rejects non-positive or invalid numbers.
 *
 * @param {string} text - User message text
 * @returns {{ success: boolean, items: Array, errors: Array<string> }}
 */
export function parseInvoiceText(text) {
  if (!text || typeof text !== "string") {
    return { success: false, items: [], errors: ["Input text is empty."] };
  }

  const lines = text.split("\n");
  const items = [];
  const errors = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    const lineNum = i + 1;

    // Skip empty lines
    if (!rawLine) continue;

    // Split line by whitespace
    const tokens = rawLine.split(/\s+/);

    if (tokens.length < 2) {
      errors.push(`Line ${lineNum}: "${rawLine}" must contain an item description and price.`);
      continue;
    }

    const lastToken = tokens[tokens.length - 1];
    const secondLastToken = tokens[tokens.length - 2];

    const lastNum = Number(lastToken);
    const secondLastNum = Number(secondLastToken);

    let quantity = 1;
    let price = null;
    let descriptionTokens = [];

    // Case 1: Two trailing numbers (e.g. "banana 2 50" or "web design 1 5000")
    if (tokens.length >= 3 && !isNaN(secondLastNum) && !isNaN(lastNum)) {
      quantity = secondLastNum;
      price = lastNum;
      descriptionTokens = tokens.slice(0, tokens.length - 2);
    }
    // Case 2: One trailing number (e.g. "apple 499" or "orange juice 120")
    else if (!isNaN(lastNum)) {
      quantity = 1;
      price = lastNum;
      descriptionTokens = tokens.slice(0, tokens.length - 1);
    } else {
      errors.push(`Line ${lineNum}: Missing valid price in "${rawLine}".`);
      continue;
    }

    const description = descriptionTokens.join(" ").trim();

    // Validation: Description must not be empty
    if (!description) {
      errors.push(`Line ${lineNum}: Missing item description in "${rawLine}".`);
      continue;
    }

    // Validation: Quantity must be positive
    if (quantity <= 0 || !Number.isFinite(quantity)) {
      errors.push(`Line ${lineNum}: Quantity for "${description}" must be greater than 0.`);
      continue;
    }

    // Validation: Price must be positive
    if (price <= 0 || !Number.isFinite(price)) {
      errors.push(`Line ${lineNum}: Price for "${description}" must be greater than 0.`);
      continue;
    }

    // Capitalize first character of description
    const formattedDescription = description.charAt(0).toUpperCase() + description.slice(1);

    // Convert price to integer paise to eliminate floating-point precision issues
    const unitPricePaise = Math.round(price * 100);
    const totalPaise = Math.round(quantity * unitPricePaise);

    items.push({
      description: formattedDescription,
      quantity,
      unitPrice: price,
      unitPricePaise,
      totalPaise,
    });
  }

  if (errors.length > 0) {
    return { success: false, items: [], errors };
  }

  if (items.length === 0) {
    return { success: false, items: [], errors: ["No valid invoice items found."] };
  }

  return { success: true, items, errors: [] };
}

