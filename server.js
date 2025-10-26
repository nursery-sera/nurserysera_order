// ================================
// server.js（修正版・完全版）
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

dotenv.config(); // ← .env を読み込み

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// 空文字や未定義を NULL にするユーティリティ
function nn(v) {
  return (v === undefined || v === null || String(v).trim() === "") ? null : v;
}

// 文字列を安全に連結（undefined/null/空文字を無視）
function joinSafe(parts, sep = "") {
  return parts.filter(p => p !== null && p !== undefined && String(p).trim() !== "").join(sep);
}

// B2の時間帯コードはそのまま渡す想定（例: "0812","1416" 等）
// 必要があればここで変換テーブルを実装
function normalizeTimeSlot(code) {
  return nn(code); // 今回はそのまま
}

// 日付を B2 が読みやすい "YYYY/MM/DD" に統一（delivery_dateは任意）
function formatDateYYYYMMDD(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const da = String(dt.getDate()).padStart(2, "0");
  return `${y}/${m}/${da}`;
}

// === テーブル存在チェック＆作成 ===
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

// === 注文データ登録 ===
app.post("/api/orders", async (req, res) => {
  try {
    // index.html 側 payload 構造に準拠
    const c = req.body.customer || {};
    const d = req.body.delivery || {};

    // delivery_date が '' のときは NULL にする（DATE 型対策）
    const deliveryDate = nn(d.desired_date); // '' -> null
    const timeSlot     = nn(d.desired_time);

    const q = `
      INSERT INTO orders (
        last_name, first_name, zipcode, prefecture, city, address, building,
        phone, email, instagram, delivery_date, time_slot, memo
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `;

    const v = [
      nn(c.lastName),
      nn(c.firstName),
      nn(c.zipcode),
      nn(c.prefecture),
      nn(c.city),
      nn(c.address),
      nn(c.building),
      nn(c.phone),
      nn(c.email),
      nn(c.instagram),
      deliveryDate,        // ← NULL になり得る
      timeSlot,            // ← NULL になり得る
      nn(req.body.note),
    ];

    await pool.query(q, v);
    res.json({ ok: true });
  } catch (e) {
    console.error("DB保存エラー:", e);
    res.status(500).json({ error: "DB保存エラー", detail: e.message });
  }
});

// === 一覧表示 ===
app.get("/api/orders", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM orders ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (e) {
    console.error("一覧取得エラー:", e);
    res.status(500).json({ error: "一覧取得エラー", detail: e.message });
  }
});

// === CSV出力（ヤマトB2クラウド形式：住所1/住所2を分離、delivery_dateは「お届け予定日」） ===
app.get("/api/orders/csv", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
    const rows = result.rows;

    // 出力ファイル名（実行ごとにユニークに）
    const fileName = `orders_b2_${Date.now()}.csv`;
    const filePath = path.join(__dirname, fileName);

    // CSVヘッダ：住所を「お届け先住所１」「お届け先住所２」に分割
    const csvWriter = createObjectCsvWriter({
      path: filePath,
      header: [
        { id: "manage_no",        title: "お客様管理番号" },
        { id: "slip_type",        title: "送り状種類" },
        { id: "cool_type",        title: "クール区分" },
        { id: "den_no",           title: "伝票番号" },
        { id: "ship_date",        title: "出荷予定日" },
        { id: "delivery_date",    title: "お届け予定日" },   // ← フォームの delivery_date をここへ
        { id: "time_slot",        title: "お届け時間帯" },
        { id: "dest_phone",       title: "お届け先電話番号" },
        { id: "dest_zip",         title: "お届け先郵便番号" },
        { id: "dest_addr1",       title: "お届け先住所１" }, // 都道府県＋市区町村＋番地
        { id: "dest_addr2",       title: "お届け先住所２" }, // 建物名・号室（任意）
        { id: "dest_company",     title: "お届け先会社・部門名" },
        { id: "dest_name",        title: "お届け先名" },     // last + first
        { id: "dest_name_kana",   title: "お届け先名(カナ)" },
        { id: "title",            title: "敬称" },
        { id: "item_code1",       title: "品名コード1" },
        { id: "item_name1",       title: "品名1" },
        { id: "qty",              title: "出荷個数" },
        { id: "note",             title: "記事" },
        { id: "sender_phone",     title: "発送元電話番号" },
        { id: "sender_zip",       title: "発送元郵便番号" },
        { id: "sender_addr",      title: "発送元住所" },
        { id: "sender_name",      title: "発送元名" },
      ],
      encoding: "utf8",
      // ヘッダ行にBOMを付けたい場合は createObjectCsvStringifier で自前対応が必要
    });

    // 発送元（固定値）
    const sender = {
      phone: "09067309120",
      zip: "5798023",
      addr: "大阪府東大阪市立花町14-4",
      name: "NURSERY SERA",
    };

    const records = rows.map((r, i) => {
      const destName = joinSafe([r.last_name, r.first_name], " "); // last + first
      const destAddr1 = joinSafe([r.prefecture, r.city, r.address], ""); // 住所1
      const destAddr2 = nn(r.building) || ""; // 住所2（任意）

      return {
        manage_no: String(i + 1).padStart(4, "0"),
        slip_type: 0,                 // 宅急便など（必要に応じて固定）
        cool_type: 0,                 // クール無し=0
        den_no: "",                   // 未発行
        ship_date: "",                // 出荷予定日は別管理なので空
        delivery_date: formatDateYYYYMMDD(r.delivery_date), // ← お届け予定日
        time_slot: normalizeTimeSlot(r.time_slot),          // そのまま or 変換
        dest_phone: r.phone || "",
        dest_zip: (r.zipcode || "").replace(/\D/g, ""),     // 数字のみ（任意整形）
        dest_addr1: destAddr1,
        dest_addr2: destAddr2,
        dest_company: "",
        dest_name: destName,
        dest_name_kana: "",
        title: "様",
        item_code1: "",
        item_name1: "フラワーギフト",
        qty: 1,
        note: r.memo || "",
        sender_phone: sender.phone,
        sender_zip: sender.zip,
        sender_addr: sender.addr,
        sender_name: sender.name,
      };
    });

    await csvWriter.writeRecords(records);

    // ダウンロードさせる
    res.download(filePath, "orders_b2.csv", (err) => {
      if (err) {
        console.error("CSVダウンロードエラー:", err);
      }
      // 送信後にファイル削除（サーバに残さない運用）
      fs.unlink(filePath, () => {});
    });
  } catch (e) {
    console.error("CSV出力エラー:", e);
    res.status(500).json({ error: "CSV出力エラー", detail: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚚 Server running on port ${PORT}`);
});