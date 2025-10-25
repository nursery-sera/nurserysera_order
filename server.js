import express from "express";
import pkg from "pg";
import cors from "cors";
import fs from "fs";
import { createObjectCsvWriter } from "csv-writer";

const { Pool } = pkg;
const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

app.use(cors());
app.use(express.json());
app.use(express.static("public"));
app.use("/admin", express.static("admin"));

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

// === 顧客データ登録 ===
app.post("/api/orders", async (req, res) => {
  try {
    const q = `
      INSERT INTO orders (last_name, first_name, zipcode, prefecture, city, address, building, phone, email, instagram, delivery_date, time_slot, memo)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `;
    const v = [
      req.body.lastName, req.body.firstName, req.body.zipcode, req.body.prefecture,
      req.body.city, req.body.address, req.body.building, req.body.phone,
      req.body.email, req.body.instagram, req.body.deliveryDate, req.body.timeSlot, req.body.memo
    ];
    await pool.query(q, v);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "DB保存エラー" });
  }
});

// === 一覧表示 ===
app.get("/api/orders", async (req, res) => {
  const result = await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
  res.json(result.rows);
});

// === CSV出力（ヤマトB2クラウド対応） ===
app.get("/api/orders/csv", async (req, res) => {
  const result = await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
  const rows = result.rows;

  const filePath = "./orders_b2.csv";
  const csvWriter = createObjectCsvWriter({
    path: filePath,
    header: [
      { id: "manage_no", title: "お客様管理番号" },
      { id: "slip_type", title: "送り状種類" },
      { id: "cool_type", title: "クール区分" },
      { id: "den_no", title: "伝票番号" },
      { id: "ship_date", title: "出荷予定日" },
      { id: "delivery_date", title: "お届け予定日" },
      { id: "time_slot", title: "お届け時間帯" },
      { id: "dest_phone", title: "お届け先電話番号" },
      { id: "dest_zip", title: "お届け先郵便番号" },
      { id: "dest_addr", title: "お届け先住所" },
      { id: "dest_company", title: "お届け先会社・部門名" },
      { id: "dest_name", title: "お届け先名" },
      { id: "dest_name_kana", title: "お届け先名(カナ)" },
      { id: "title", title: "敬称" },
      { id: "item_code1", title: "品名コード1" },
      { id: "item_name1", title: "品名1" },
      { id: "qty", title: "出荷個数" },
      { id: "note", title: "記事" },
      { id: "sender_phone", title: "発送元電話番号" },
      { id: "sender_zip", title: "発送元郵便番号" },
      { id: "sender_addr", title: "発送元住所" },
      { id: "sender_name", title: "発送元名" }
    ],
  });

  const sender = {
    phone: "09000000000",
    zip: "1234567",
    addr: "大阪府大阪市中央区○○1-2-3",
    name: "nursery sera"
  };

  const records = rows.map((r, i) => ({
    manage_no: String(i + 1).padStart(4, "0"),
    slip_type: 0,
    cool_type: 0,
    den_no: "",
    ship_date: "",
    delivery_date: r.delivery_date ? new Date(r.delivery_date).toLocaleDateString("ja-JP") : "",
    time_slot: r.time_slot,
    dest_phone: r.phone,
    dest_zip: r.zipcode,
    dest_addr: `${r.prefecture}${r.city}${r.address}${r.building}`,
    dest_company: "",
    dest_name: `${r.last_name} ${r.first_name}`,
    dest_name_kana: "",
    title: "様",
    item_code1: "",
    item_name1: "フラワーギフト",
    qty: 1,
    note: r.memo || "",
    sender_phone: sender.phone,
    sender_zip: sender.zip,
    sender_addr: sender.addr,
    sender_name: sender.name
  }));

  await csvWriter.writeRecords(records);
  res.download(filePath, "orders_b2.csv");
});

app.listen(PORT, () => console.log(`🚚 Server running on port ${PORT}`));
