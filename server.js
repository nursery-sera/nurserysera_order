// ================================
// server.js（管理画面 追加要件対応版）
// nursery sera — ご注文フォームAPI
// ================================

import express from "express";
import pkg from "pg";
import cors from "cors";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { createObjectCsvWriter } from "csv-writer";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pkg;
const app = express();
const PORT = process.env.PORT || 3000;

// === 固定値 ===
const BILLING_CUSTOMER_CODE = "09067309120";
const FREIGHT_MANAGEMENT_NO = "01";          // 発払いの運賃管理番号（固定）
const DEFAULT_ITEM_NAME = "観葉植物";

const CONSIGNOR = {
  phone: "09067309120",
  zip: "5798023",
  addr: "大阪府東大阪市立花町14-4",
  name: "NURSERY SERA",
};

// === DB ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

app.use(cors());
app.use(express.json());
app.use(express.static("public"));
app.use("/admin", express.static("admin"));

// === ユーティリティ ===
function nn(v){ return (v===undefined || v===null || String(v).trim()==="") ? null : v; }
function joinSafe(parts, sep=""){ return parts.filter(p=>p!==null && p!==undefined && String(p).trim()!=="").join(sep); }

// B2時間帯コード（4桁）正規化
function normalizeTimeSlot(input){
  if (!input) return "";
  const VALID = ["0812","1214","1416","1618","1820","2021"];
  const s = String(input).trim();
  if (/^(0812|1214|1416|1618|1820|2021)$/.test(s)) return s;
  const t = s.replace(/[：:]/g, ":").replace(/[～~\\-ー−－]/g, "-").replace(/\s/g,"");
  if (/午前中/.test(t)) return "0812";
  const m = t.match(/(\d{1,2})(?::?\d{0,2})?-(\d{1,2})(?::?\d{0,2})?/);
  if (m){
    const a = m[1].padStart(2,"0");
    const b = m[2].padStart(2,"0");
    const code = `${a}${b}`;
    if (VALID.includes(code)) return code;
  }
  return "";
}

// "YYYY/MM/DD" に統一
function formatDateYYYYMMDD(d){
  if (!d) return "";
  const s = String(d).replaceAll("-", "/");
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,"0");
  const da = String(dt.getDate()).padStart(2,"0");
  return `${y}/${m}/${da}`;
}

// === CSVヘッダ定義 ===
const CSV_HEADER_MASTER = [
  { id: "manage_no",         title: "お客様管理番号" },
  { id: "slip_type",         title: "送り状種類" },
  { id: "cool_type",         title: "クール区分" },
  { id: "den_no",            title: "伝票番号" },
  { id: "ship_date",         title: "出荷予定日" },
  { id: "delivery_date",     title: "お届け予定日" },
  { id: "time_slot",         title: "お届け時間帯" },
  { id: "dest_phone",        title: "お届け先電話番号" },
  { id: "dest_zip",          title: "お届け先郵便番号" },
  { id: "dest_addr1",        title: "お届け先住所１" },
  { id: "dest_addr2",        title: "お届け先住所２" },
  { id: "dest_company",      title: "お届け先会社・部門名" },
  { id: "dest_name",         title: "お届け先名" },
  { id: "dest_name_kana",    title: "お届け先名(カナ)" },
  { id: "title",             title: "敬称" },
  { id: "item_code1",        title: "品名コード1" },
  { id: "item_name1",        title: "品名1" },
  { id: "qty",               title: "出荷個数" },
  { id: "note",              title: "記事" },
  { id: "consignor_phone",   title: "ご依頼主電話番号" },
  { id: "consignor_zip",     title: "ご依頼主郵便番号" },
  { id: "consignor_addr",    title: "ご依頼主住所" },
  { id: "consignor_name",    title: "ご依頼主名" },
  { id: "bill_customer_code",title: "ご請求先顧客コード" },
  { id: "freight_mgmt_no",   title: "運賃管理番号" },
];

// === テーブル作成 ===
await pool.query(`
  CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    last_name TEXT,
    first_name TEXT,
    zipcode TEXT,
    prefecture TEXT,
    city TEXT,
    address TEXT,
    building TEXT,
    phone TEXT,
    email TEXT,
    instagram TEXT,
    delivery_date DATE,
    time_slot TEXT,
    memo TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

// === API ===

app.post("/api/orders", async (req, res) => {
  try {
    const c = req.body.customer || {};
    const d = req.body.delivery || {};
    const deliveryDate = nn(d.desired_date);
    const timeSlot     = nn(d.desired_time);

    const q = `
      INSERT INTO orders (
        last_name, first_name, zipcode, prefecture, city, address, building,
        phone, email, instagram, delivery_date, time_slot, memo
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `;
    const v = [
      nn(c.lastName), nn(c.firstName), nn(c.zipcode), nn(c.prefecture), nn(c.city),
      nn(c.address), nn(c.building), nn(c.phone), nn(c.email), nn(c.instagram),
      deliveryDate, timeSlot, nn(req.body.note),
    ];
    await pool.query(q, v);
    res.json({ ok: true });
  } catch (e) {
    console.error("DB保存エラー:", e);
    res.status(500).json({ error: "DB保存エラー", detail: e.message });
  }
});

app.get("/api/orders", async (_req, res) => {
  try {
    const result = await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (e) {
    console.error("一覧取得エラー:", e);
    res.status(500).json({ error: "一覧取得エラー", detail: e.message });
  }
});

app.get("/api/orders/csv/headers", (_req, res) => {
  res.json(CSV_HEADER_MASTER);
});

app.get("/api/orders/csv", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
    const shipDateFmt = formatDateYYYYMMDD(req.query?.ship_date || "");
    const { buffer, name } = await buildCsvBuffer(result.rows, null, null, shipDateFmt);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.send(buffer);
  } catch (e) {
    console.error("CSV出力エラー:", e);
    res.status(500).json({ error: "CSV出力エラー", detail: e.message });
  }
});

app.post("/api/orders/csv", async (req, res) => {
  try {
    const selections = Array.isArray(req.body?.selections) ? req.body.selections : [];
    const selectedCols = Array.isArray(req.body?.columns) ? req.body.columns : [];
    const shipDateFmt = formatDateYYYYMMDD(req.body?.ship_date || "");

    if (selections.length === 0) {
      return res.status(400).json({ error: "NO_SELECTION", detail: "対象行がありません。" });
    }
    if (selectedCols.length === 0) {
      return res.status(400).json({ error: "NO_COLUMNS", detail: "CSV項目が選択されていません。" });
    }

    const slipMap = new Map();
    for (const s of selections) {
      const code = (s?.slip_type === "A") ? "A" : "0";
      slipMap.set(Number(s.id), code);
    }

    const ids = selections.map(s => Number(s.id)).filter(Number.isFinite);
    const placeholders = ids.map((_,i)=>`$${i+1}`).join(",");
    const q = `SELECT * FROM orders WHERE id IN (${placeholders}) ORDER BY created_at DESC`;
    const { rows } = await pool.query(q, ids);

    const { buffer, name } = await buildCsvBuffer(rows, selectedCols, slipMap, shipDateFmt);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.send(buffer);
  } catch (e) {
    console.error("CSV生成エラー:", e);
    res.status(500).json({ error: "CSV生成エラー", detail: e.message });
  }
});

// === CSV生成 ===
async function buildCsvBuffer(rows, selectedCols, slipMap, shipDate){
  const headers = (selectedCols && selectedCols.length)
    ? CSV_HEADER_MASTER.filter(h => selectedCols.includes(h.id))
    : CSV_HEADER_MASTER.slice();
  if (headers.length === 0) throw new Error("ヘッダが空です");

  const fileName = `orders_b2_${Date.now()}.csv`;
  const filePath = path.join(__dirname, fileName);

  const writer = createObjectCsvWriter({
    path: filePath,
    header: headers,
    encoding: "utf8",
    alwaysQuote: false,
  });

  const records = rows.map((r, i) => {
    const destName  = joinSafe([r.last_name, r.first_name], " ");
    const destAddr1 = joinSafe([r.prefecture, r.city, r.address], "");
    const destAddr2 = nn(r.building) || "";
    const slipType  = slipMap?.get(Number(r.id)) ?? "0";
    const ship      = shipDate || "";
    let delivery    = formatDateYYYYMMDD(r.delivery_date);

    // 🟢 追加：お届け予定日が空なら「最短日」と記載
    if (!delivery) delivery = "最短日";

    return {
      manage_no: String(i + 1).padStart(4, "0"),
      slip_type: slipType,
      cool_type: 0,
      den_no: "",
      ship_date: ship,
      delivery_date: delivery,
      time_slot: normalizeTimeSlot(r.time_slot),
      dest_phone: r.phone || "",
      dest_zip: (r.zipcode || "").replace(/\D/g, ""),
      dest_addr1: destAddr1,
      dest_addr2: destAddr2,
      dest_company: "",
      dest_name: destName,
      dest_name_kana: "",
      title: "様",
      item_code1: "",
      item_name1: DEFAULT_ITEM_NAME,
      qty: 1,
      note: r.memo || "",
      consignor_phone: CONSIGNOR.phone,
      consignor_zip: CONSIGNOR.zip,
      consignor_addr: CONSIGNOR.addr,
      consignor_name: CONSIGNOR.name,
      bill_customer_code: BILLING_CUSTOMER_CODE,
      freight_mgmt_no: FREIGHT_MANAGEMENT_NO,
    };
  });

  await writer.writeRecords(records);
  const buffer = await fs.promises.readFile(filePath);
  await fs.promises.unlink(filePath).catch(()=>{});
  return { buffer, name: "orders_b2.csv" };
}

app.listen(PORT, () => {
  console.log(`🚚 Server running on port ${PORT}`);
});