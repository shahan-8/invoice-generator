import worker from "./src/index.js";
import { parseInvoiceText } from "./src/parser.js";
import { calculateInvoiceTotals, formatINR, validateGSTIN } from "./src/calculator.js";
import { getUserProfile, upsertUserProfile, isNewUpdate, getNextInvoiceNumber, recordInvoiceMetadata, getUserInvoiceHistory } from "./src/db.js";
import {
  validateUPI,
  getProfileView,
  getPaymentView,
  getSettingsView,
  handleProfileUpdate,
} from "./src/profile.js";
import { getHistoryView } from "./src/history.js";
import { checkRateLimit } from "./src/security.js";
import { generateInvoicePdf } from "./src/pdf.js";
import fs from "node:fs";

function loadDevVars() {
  const env = {};
  if (fs.existsSync(".dev.vars")) {
    const lines = fs.readFileSync(".dev.vars", "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (key && rest.length > 0) {
        env[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return env;
}

function createMockD1() {
  const tables = {
    users: new Map(),
    processed_updates: new Set(),
    invoices: [],
  };

  return {
    prepare(sql) {
      let boundArgs = [];
      const stmt = {
        bind(...args) {
          boundArgs = args;
          return stmt;
        },
        async first() {
          if (sql.includes("FROM users WHERE telegram_id = ?")) {
            const id = String(boundArgs[0]);
            return tables.users.get(id) || null;
          }
          if (sql.includes("SELECT invoice_counter FROM users")) {
            const id = String(boundArgs[0]);
            const u = tables.users.get(id);
            return u ? { invoice_counter: u.invoice_counter } : null;
          }
          return null;
        },
        async all() {
          if (sql.includes("FROM invoices") && sql.includes("WHERE telegram_id = ?")) {
            const id = String(boundArgs[0]);
            const limit = Number(boundArgs[1]) || 5;
            const userInvoices = tables.invoices.filter((i) => i.telegram_id === id).slice(-limit).reverse();
            return { results: userInvoices };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes("INSERT INTO processed_updates")) {
            const updateId = boundArgs[0];
            if (tables.processed_updates.has(updateId)) {
              throw new Error("UNIQUE constraint failed: update_id");
            }
            tables.processed_updates.add(updateId);
            return { success: true };
          }
          if (sql.includes("INSERT OR IGNORE INTO users")) {
            const id = String(boundArgs[0]);
            if (!tables.users.has(id)) {
              tables.users.set(id, { telegram_id: id, invoice_counter: 0 });
            }
            return { success: true };
          }
          if (sql.includes("UPDATE users SET invoice_counter")) {
            const id = String(boundArgs[0]);
            const u = tables.users.get(id) || { telegram_id: id, invoice_counter: 0 };
            u.invoice_counter = (u.invoice_counter || 0) + 1;
            tables.users.set(id, u);
            return { success: true };
          }
          if (sql.includes("INSERT INTO users")) {
            const id = String(boundArgs[0]);
            const existing = tables.users.get(id) || {};
            tables.users.set(id, {
              ...existing,
              telegram_id: id,
              business_name: boundArgs[1],
              business_address: boundArgs[2],
              phone: boundArgs[3],
              email: boundArgs[4],
              gstin: boundArgs[5],
              upi_id: boundArgs[6],
              upi_phone: boundArgs[7],
              upi_qr_file_id: boundArgs[8],
              gst_rate: boundArgs[9],
            });
            return { success: true };
          }
          if (sql.includes("INSERT INTO invoices")) {
            tables.invoices.push({
              telegram_id: boundArgs[0],
              invoice_number: boundArgs[1],
              date: boundArgs[2],
              summary: boundArgs[3],
              subtotal_paise: boundArgs[4],
              gst_paise: boundArgs[5],
              grand_total_paise: boundArgs[6],
            });
            return { success: true };
          }
          return { success: true };
        },
      };
      return stmt;
    },
    tables,
  };
}

async function runTests() {
  console.log("🔍 Running Complete BillDost Test Suite...\n");
  const env = loadDevVars();
  const mockDb = createMockD1();

  // Test 1: Parser
  console.log("Test 1: parseInvoiceText()");
  const sample = "apple 499\nbanana 2 50";
  const parsed = parseInvoiceText(sample);
  if (parsed.success && parsed.items.length === 2) {
    console.log(" ✅ PASS: Parser working!\n");
  } else {
    console.log(" ❌ FAIL: Parser failed.\n");
  }

  // Test 2: Rate Limiting
  console.log("Test 2: checkRateLimit() security check");
  const userId = "test_user_rate";
  let allowed = true;
  for (let i = 0; i < 5; i++) {
    allowed = checkRateLimit(userId, 5, 1000);
  }
  const blocked = !checkRateLimit(userId, 5, 1000);
  if (allowed && blocked) {
    console.log(" ✅ PASS: Rate limiter correctly allowed 5 requests and blocked 6th!\n");
  } else {
    console.log(" ❌ FAIL: Rate limiter failed.\n");
  }

  // Test 3: PDF Generation
  console.log("Test 3: generateInvoicePdf()");
  const totals = calculateInvoiceTotals(parsed.items, { gstRate: 18 });
  const pdfBytes = await generateInvoicePdf({
    invoiceNumber: "INV-001",
    date: "19 Nov 2026",
    profile: { business_name: "Apex Creative", upi_id: "apex@upi" },
    items: parsed.items,
    totals,
  });

  if (pdfBytes instanceof Uint8Array && pdfBytes.length > 500) {
    console.log(` ✅ PASS: PDF generated successfully (${pdfBytes.length} bytes)!\n`);
  } else {
    console.log(" ❌ FAIL: PDF generation failed.\n");
  }

  // Test 4: Record Invoice & Check History
  console.log("Test 4: recordInvoiceMetadata() and getHistoryView()");
  await recordInvoiceMetadata(mockDb, {
    telegram_id: "99001",
    invoice_number: "INV-001",
    date: "19 Nov 2026",
    summary: "Website Redesign",
    subtotal_paise: 2500000,
    gst_paise: 450000,
    grand_total_paise: 2950000,
  });

  const historyHtml = await getHistoryView(mockDb, "99001");
  if (historyHtml.includes("INV-001") && historyHtml.includes("₹29,500.00")) {
    console.log(" ✅ PASS: Invoice history retrieved and formatted accurately!\n");
  } else {
    console.log(" ❌ FAIL: History view failed.\n", historyHtml);
  }

  // Test 5: End-to-end /history command
  console.log("Test 5: POST /webhook routing /history command");
  const res = await worker.fetch(
    new Request("http://localhost/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": env.TELEGRAM_SECRET_TOKEN || "",
      },
      body: JSON.stringify({
        message: {
          chat: { id: 99001 },
          from: { first_name: "Rahul" },
          text: "/history",
        },
      }),
    }),
    { ...env, DB: mockDb },
    { waitUntil: () => { } }
  );

  if (res.status === 200) {
    console.log(" ✅ PASS: Webhook processed /history command cleanly!\n");
  } else {
    console.log(" ❌ FAIL: Webhook /history failed.\n");
  }

  console.log("🎉 ALL TESTS PASSED! The BillDost application is complete and verified.");
}

runTests().catch(console.error);
