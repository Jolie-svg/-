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
  
  // 更加健壯的私鑰處理：
  // 1. 處理 Vercel 可能將 \n 轉義為 \\n 的問題
  // 2. 移除前後可能存在的雙引號或單引號
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (privateKey) {
    privateKey = privateKey
      .replace(/\\n/g, '\n') // 處理轉義換行
      .replace(/^['"]|['"]$/g, '') // 移除前後引號
      .trim();
  }

  if (!clientEmail || !privateKey) {
    return res.status(500).json({ 
      error: "伺服器環境變數未設定或格式錯誤 (GOOGLE_SERVICE_ACCOUNT_EMAIL 或 GOOGLE_PRIVATE_KEY)" 
    });
  }

  // 檢查私鑰是否包含 PEM 標頭，如果沒有則補上（預防萬一）
  if (privateKey && !privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
     console.warn("Private Key seems to be missing PEM headers, attempting to fix...");
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
