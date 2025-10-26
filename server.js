// ================================
// server.js（完全版・必須項目対応）
// nursery sera — ご注文フォームAPI
// ================================

import express from "express";
import pkg from "pg";
import cors from "cors";
import fs from "fs";
import dotenv from "dotenv";
import { createObjectCsvWriter } from "csv-writer";

dotenv.config();

const { Pool } = pkg;
const app = express();
const PORT = process.env.PORT || 3000;

// === PostgreSQL接続設定 ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

app.use(cors());
app.use(express.json());
app.use(express.static("public"));
app.use("/admin", express.static("admin"));

// 空文字をNULL化
function nn(v) {
  return (v === undefined || v === null || String(v).trim() === "") ? null : v;
}

// === ordersテーブル作成 ===
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

// === 注文登録 ===
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
      nn(c.lastName), nn(c.firstName),
      nn(c.zipcode), nn(c.prefecture), nn(c.city), nn(c.address), nn(c.building),
      nn(c.phone), nn(c.email), nn(c.instagram),
      deliveryDate, timeSlot, nn(req.body.note),
    ];
    await pool.query(q, v);
    res.json({ ok: true });
  } catch (e) {
    console.error("DB保存エラー:", e);
    res.status(500).json({ error: "DB保存エラー", detail: e.message });
  }
});

// === 一覧 ===
app.get("/api/orders", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (e) {
    console.error("一覧取得エラー:", e);
    res.status(500).json({ error: "一覧取得エラー", detail: e.message });
  }
});

// === CSV出力（ヤマトB2クラウド：必須項目対応） ===
app.get("/api/orders/csv", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
    const rows = result.rows;

    const filePath = "./orders_b2.csv";

    const csvWriter = createObjectCsvWriter({
      path: filePath,
      header: [
        { id: "manage_no", title: "お客様管理番号" },
        { id: "slip_type", title: "送り状種類" },
        { id: "ship_date", title: "出荷予定日" },
        { id: "dest_phone", title: "お届け先電話番号" },
        { id: "dest_zip", title: "お届け先郵便番号" },
        { id: "dest_addr", title: "お届け先住所" },
        { id: "dest_name", title: "お届け先名" },
        { id: "sender_phone", title: "ご依頼主電話番号" },
        { id: "sender_zip", title: "ご依頼主郵便番号" },
        { id: "sender_addr", title: "ご依頼主住所" },
        { id: "sender_name", title: "ご依頼主名" },
        { id: "item_name1", title: "品名1" },
        { id: "bill_to_code", title: "請求先顧客コード" },
        { id: "freight_mgmt", title: "運賃管理番号" },
      ],
    });

    // === 発送元情報 ===
    const sender = {
      phone: process.env.SENDER_PHONE || "09067309120",
      zip: process.env.SENDER_ZIP || "5798023",
      addr: process.env.SENDER_ADDR || "大阪府東大阪市立花町14-4",
      name: process.env.SENDER_NAME || "NURSERY SERA",
    };

    // === 日付 ===
    const today = new Date();
    const shipDate = today.toISOString().split("T")[0].replace(/-/g, "/");

    // === 請求情報 ===
    const BILL_TO_CODE = process.env.BILL_TO_CODE || "9999999999";
    const FREIGHT_MGMT = process.env.FREIGHT_MGMT || "30";

    const records = rows.map((r, i) => ({
      manage_no: String(i + 1).padStart(4, "0"),
      slip_type: "0",
      ship_date: shipDate,
      dest_phone: r.phone || "",
      dest_zip: (r.zipcode || "").replace(/\D/g, ""),
      dest_addr: `${r.prefecture || ""}${r.city || ""}${r.address || ""}${r.building || ""}`,
      dest_name: `${r.last_name || ""} ${r.first_name || ""}`.trim(),
      sender_phone: sender.phone,
      sender_zip: sender.zip,
      sender_addr: sender.addr,
      sender_name: sender.name,
      item_name1: "フラワーギフト",
      bill_to_code: BILL_TO_CODE,
      freight_mgmt: FREIGHT_MGMT,
    }));

    await csvWriter.writeRecords(records);
    res.download(filePath, "orders_b2.csv");
  } catch (e) {
    console.error("CSV出力エラー:", e);
    res.status(500).json({ error: "CSV出力エラー", detail: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚚 Server running on port ${PORT}`);
});