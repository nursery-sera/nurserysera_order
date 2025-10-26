// ================================
// server.js（完全版・必須項目対応 + 発払い/ネコポス切替）
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
    // const d = req.body.delivery || {}; // 今回は配送希望日は必須ではないとして null 固定

    // 必須ではない項目は全て `null` で登録 (CSV出力時に空文字 "" にする)
    const building = null;    
    const instagram = null;   
    const deliveryDate = null; 
    const timeSlot = null;     
    const memo = null;         

    const q = `
      INSERT INTO orders (
        last_name, first_name, zipcode, prefecture, city, address, building,
        phone, email, instagram, delivery_date, time_slot, memo
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `;
    const v = [
      nn(c.lastName), nn(c.firstName),
      nn(c.zipcode), nn(c.prefecture), nn(c.city), nn(c.address), building, // building: null
      nn(c.phone), nn(c.email), instagram, // instagram: null
      deliveryDate, timeSlot, memo, // deliveryDate, timeSlot, memo: null
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

// === CSV出力（ヤマトB2クラウド「外部データ取り込み基本レイアウト」形式） ===
app.get("/api/orders/csv", async (req, res) => {
  try {
    const type = req.query.type || "0"; // 0: 発払い, A: ネコポス
    const result = await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
    const rows = result.rows;

    const filePath = "./orders_b2_new.csv";

    // 🏆 ヤマトB2クラウド「外部データ取り込み基本レイアウト」のヘッダーに合わせる 🏆
    const csvWriter = createObjectCsvWriter({
      path: filePath,
      header: [
        { id: "manage_no", title: "お客様管理番号" },
        { id: "slip_type", title: "送り状種類" },
        { id: "ship_date", title: "出荷予定日" },
        { id: "delivery_type", title: "お届け先コード" },
        { id: "dest_phone", title: "お届け先電話番号" },
        { id: "dest_zip", title: "お届け先郵便番号" },
        { id: "dest_addr", title: "お届け先住所" },
        { id: "dest_name", title: "お届け先名" },
        { id: "dest_kana", title: "お届け先名(カナ)" },
        { id: "sender_phone", title: "ご依頼主電話番号" },
        { id: "sender_zip", title: "ご依頼主郵便番号" },
        { id: "sender_addr", title: "ご依頼主住所" },
        { id: "sender_name", title: "ご依頼主名" },
        { id: "sender_kana", title: "ご依頼主名(カナ)" },
        { id: "item_name1", title: "品名1" },
        { id: "item_name2", title: "品名2" },
        { id: "item_name_kana", title: "品名カナ" },
        { id: "item_pieces", title: "個数" },
        { id: "item_size", title: "サイズ" },
        { id: "item_weight", title: "重量" },
        { id: "delivery_date", title: "お届け予定日" },
        { id: "time_slot", title: "お届け時間帯" },
        { id: "payment_type", title: "請求区分" },
        { id: "bill_to_code", title: "請求先顧客コード" },
        { id: "freight_mgmt", title: "運賃管理番号" },
        { id: "daibiki_amount", title: "代金引換額" },
        { id: "daibiki_tax", title: "代金引換消費税" },
        { id: "payment_method", title: "決済方法" },
        { id: "memo", title: "備考" },
        { id: "handling_type", title: "取扱区分" },
        { id: "cust_shipping_mgmt", title: "お客様出荷管理番号" },
        { id: "search_key1_title", title: "検索キータイトル1" },
        { id: "search_key1", title: "検索キー1" },
        { id: "search_key2_title", title: "検索キータイトル2" },
        { id: "search_key2", title: "検索キー2" },
        { id: "multi_key", title: "複数口くくりキー" },
        { id: "mail_type", title: "メール便区分" },
        { id: "gift_type", title: "ギフト指定" },
      ],
    });

    // === 発送元情報 ===
    const sender = {
      phone: "09067309120",
      zip: "5798023",
      addr: "大阪府東大阪市立花町14-4",
      name: "NURSERY SERA",
    };

    // === 固定請求情報 ===
    const PAYMENT_TYPE = "1";     // 請求区分: 1=発払い, 2=着払い, 3=コレクト (今回は発払いを想定)
    const BILL_TO_CODE = "09067309120";
    const FREIGHT_MGMT = "01";

    // === 出荷予定日 ===
    const shipDate = new Date().toISOString().split("T")[0].replace(/-/g, "/");

    const records = rows.map((r, i) => ({
      // --- 必須項目 (DBデータまたは固定値を使用) ---
      manage_no: String(i + 1).padStart(4, "0"),
      slip_type: type, 
      ship_date: shipDate,
      dest_phone: r.phone || "",
      dest_zip: (r.zipcode || "").replace(/\D/g, ""),
      // buildingがDBでNULL/空の場合も考慮し結合
      dest_addr: `${r.prefecture || ""}${r.city || ""}${r.address || ""}${r.building || ""}`,
      dest_name: `${r.last_name || ""} ${r.first_name || ""}`.trim(),
      sender_phone: sender.phone,
      sender_zip: sender.zip,
      sender_addr: sender.addr,
      sender_name: sender.name,
      item_name1: "フラワーギフト",
      // DBの値がNULLの場合も空文字にする
      delivery_date: r.delivery_date ? r.delivery_date.toISOString().split("T")[0].replace(/-/g, "/") : "", 
      time_slot: r.time_slot || "", 
      payment_type: PAYMENT_TYPE, 
      bill_to_code: BILL_TO_CODE,
      freight_mgmt: FREIGHT_MGMT,
      memo: r.memo || "", 

      // --- 必須ではない項目 (すべて空文字 "" を設定) ---
      delivery_type: "",         
      dest_kana: "",             
      sender_kana: "",           
      item_name2: "",            
      item_name_kana: "",        
      item_pieces: "",           
      item_size: "",             
      item_weight: "",           
      daibiki_amount: "",        
      daibiki_tax: "",           
      payment_method: "",        
      handling_type: "",         
      cust_shipping_mgmt: "",    
      search_key1_title: "",     
      search_key1: "",           
      search_key2_title: "",     
      search_key2: "",           
      multi_key: "",             
      mail_type: "",             
      gift_type: "",             
    }));

    await csvWriter.writeRecords(records);
    res.download(filePath, "orders_b2_new.csv");
  } catch (e) {
    console.error("CSV出力エラー:", e);
    res.status(500).json({ error: "CSV出力エラー", detail: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚚 Server running on port ${PORT}`);
});
