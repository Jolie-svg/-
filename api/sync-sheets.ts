import { google } from "googleapis";
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 只允許 POST 請求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { sheetId } = req.body;
  if (!sheetId) {
    return res.status(400).json({ error: 'Missing sheetId' });
  }

  // 取得環境變數
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  
  // 更加強大的私鑰處理：
  // 1. 處理 Vercel 可能將 \n 轉義為 \\n 的問題
  // 2. 處理可能存在的 \r (Windows 換行)
  // 3. 移除前後引號或多餘空格
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (privateKey) {
    privateKey = privateKey
      .replace(/\\n/g, '\n')       // 處理 "\\n"
      .replace(/\n/g, '\n')        // 確保換行符號正確
      .replace(/\r/g, '')          // 移除 \r
      .replace(/^["']|["']$/g, '') // 移除頭尾引號
      .trim();
  }

  if (!clientEmail || !privateKey || !privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
    console.error("Credentials error:", { email: !!clientEmail, keyExists: !!privateKey, hasHeader: privateKey?.includes('BEGIN') });
    return res.status(500).json({ 
      error: "伺服器環境變數設定錯誤。請檢查 GOOGLE_PRIVATE_KEY 是否包含完整標頭 (-----BEGIN PRIVATE KEY-----) 且無多餘轉義。" 
    });
  }

  try {
    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    });

    const sheets = google.sheets({ version: "v4", auth });
    const range = "A:Z"; 

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: range,
    });

    const rows = response.data.values || [];
    return res.status(200).json({ 
      rowCount: rows.length,
      rows: rows
    });
  } catch (error: any) {
    console.error("Google API Error:", error);
    const msg = error.response?.data?.error?.message || error.message || "讀取試算表失敗";
    return res.status(500).json({ error: `同步失敗: ${msg}` });
  }
}
