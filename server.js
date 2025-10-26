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

// === 固定値（ご依頼主／請求・管理） ===
const BILLING_CUSTOMER_CODE = "09067309120"; // ご請求先顧客コード（固定）
const FREIGHT_MANAGEMENT_NO = "01";          // 運賃管理番号（発払い）
const DEFAULT_ITEM_NAME = "フラワーギフト";  // 品名1（固定）

// ご依頼主（= 送る側の情報）
const CONSIGNOR = {
  phone: "09067309120",
  zip: "5798023",
  addr: "大阪府東大阪市立花町14-4",
  name: "NURSERY SERA",
};

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

// === B2の時間帯コード正規化（4桁コードへ変換） ===
// 受け取り： "0812" / "午前中" / "8-12" / "14:00-16:00" / "1416" など
// 返り値： "0812" | "1214" | "1416" | "1618" | "1820" | "2021" | ""（不明/未指定）
function normalizeTimeSlot(input) {
  if (!input) return "";
  const VALID = ["0812", "1214", "1416", "1618", "1820", "2021"];

  // すでに4桁コードならそのまま
  const s = String(input).trim();
  if (/^(0812|1214|1416|1618|1820|2021)$/.test(s)) return s;

  // 共通正規化
  const t = s
    .replace(/[：:]/g, ":")
    .replace(/[～~\-ー−－]/g, "-")
    .replace(/\s/g, "");

  // 日本語キーワード
  if (/午前中/.test(t)) return "0812";

  // 時刻レンジ（例: 8-12, 14:00-16:00, 12-14）
  const m = t.match(/(\d{1,2})(?::?\d{0,2})?-(\d{1,2})(?::?\d{0,2})?/);
  if (m) {
    const a = m[1].padStart(2, "0");
    const b = m[2].padStart(2, "0");
    const code = `${a}${b}`;
    if (VALID.includes(code)) return code;
  }

  // 「午前」「PM14-16」などの変則は未対応 → 空欄
  return "";
}

// 日付を "YYYY/MM/DD" に統一（delivery_dateは任意）
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

    // CSVヘッダ
    // ご依頼主* に名称を変更し、請求・管理系も追加
    const csvWriter = createObjectCsvWriter({
      path: filePath,
      header: [
        { id: "manage_no",         title: "お客様管理番号" },
        { id: "slip_type",         title: "送り状種類" },
        { id: "cool_type",         title: "クール区分" },
        { id: "den_no",            title: "伝票番号" },
        { id: "ship_date",         title: "出荷予定日" },
        { id: "delivery_date",     title: "お届け予定日" },     // ← フォームの delivery_date
        { id: "time_slot",         title: "お届け時間帯" },
        { id: "dest_phone",        title: "お届け先電話番号" },
        { id: "dest_zip",          title: "お届け先郵便番号" },
        { id: "dest_addr1",        title: "お届け先住所１" },   // 都道府県＋市区町村＋番地
        { id: "dest_addr2",        title: "お届け先住所２" },   // 建物名・号室（任意）
        { id: "dest_company",      title: "お届け先会社・部門名" },
        { id: "dest_name",         title: "お届け先名" },       // last + first
        { id: "dest_name_kana",    title: "お届け先名(カナ)" },
        { id: "title",             title: "敬称" },
        { id: "item_code1",        title: "品名コード1" },
        { id: "item_name1",        title: "品名1" },            // ← フラワーギフト固定
        { id: "qty",               title: "出荷個数" },
        { id: "note",              title: "記事" },
        // ご依頼主（発送側）
        { id: "consignor_phone",   title: "ご依頼主電話番号" },
        { id: "consignor_zip",     title: "ご依頼主郵便番号" },
        { id: "consignor_addr",    title: "ご依頼主住所" },
        { id: "consignor_name",    title: "ご依頼主名" },
        // 請求・管理
        { id: "bill_customer_code",title: "ご請求先顧客コード" }, // ← 09067309120 固定
        { id: "freight_mgmt_no",   title: "運賃管理番号" },       // ← 01 固定
      ],
      encoding: "utf8",
    });

    const records = rows.map((r, i) => {
      const destName  = joinSafe([r.last_name, r.first_name], " "); // last + first
      const destAddr1 = joinSafe([r.prefecture, r.city, r.address], ""); // 住所1
      const destAddr2 = nn(r.building) || ""; // 住所2（任意）

      return {
        manage_no: String(i + 1).padStart(4, "0"),
        slip_type: 0,                          // 宅急便
        cool_type: 0,                          // クール無し
        den_no: "",                            // 未発行
        ship_date: "",                         // 出荷予定日は別管理
        delivery_date: formatDateYYYYMMDD(r.delivery_date),
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
        item_name1: DEFAULT_ITEM_NAME,         // "フラワーギフト"
        qty: 1,
        note: r.memo || "",
        // ご依頼主（固定）
        consignor_phone: CONSIGNOR.phone,
        consignor_zip: CONSIGNOR.zip,
        consignor_addr: CONSIGNOR.addr,
        consignor_name: CONSIGNOR.name,
        // 請求・管理（固定）
        bill_customer_code: BILLING_CUSTOMER_CODE, // "09067309120"
        freight_mgmt_no: FREIGHT_MANAGEMENT_NO,    // "01"
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