import { google } from "googleapis";
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 只允許 POST 請求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 取得所有可能的 Sheet ID
  const sheetConfigs: { id: string, envKey: string }[] = [];
  
  // 1. Collect from environment variables - specifying keys to avoid picking up API keys
  const allowedEnvKeys = ['GOOGLE_SHEET_ID', 'SHEET_3', '店家面試委員排班'];
  allowedEnvKeys.forEach(key => {
    const val = process.env[key];
    if (val && val.trim() !== '' && !val.startsWith('AIzaSy')) {
      sheetConfigs.push({ id: val.trim(), envKey: key });
    }
  });
  
  // 2. 如果請求中有傳入單一 ID
  if (req.body.sheetId) {
    sheetConfigs.push({ id: req.body.sheetId, envKey: 'request_body' });
  }

  // 如果都沒有，才使用預設
  const DEFAULT_SHEET_ID = '1syQgXhAwQV2DLn54gRjsNG1NTLAR59g5hBKzJDK6uh8';
  if (sheetConfigs.length === 0) {
    sheetConfigs.push({ id: DEFAULT_SHEET_ID, envKey: 'default' });
  }

  // 去重
  const uniqueConfigs = sheetConfigs.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);

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
    const range = "A:ZZ"; // 擴大抓取範圍到 ZZ 欄位，避免後端欄位被截斷

    const results = [];
    const specialSheetEnvValue = process.env['店家面試委員排班'];
    let specialSheetId = specialSheetEnvValue;
    if (specialSheetId) {
      const sMatch = specialSheetId.match(/\/d\/([^/]+)/);
      if (sMatch) specialSheetId = sMatch[1];
    }

    for (const config of uniqueConfigs) {
      const { id: sheetId, envKey } = config;
      try {
        let cleanId = sheetId;
        const match = cleanId.match(/\/d\/([^/]+)/);
        if (match) cleanId = match[1];

        // 決定讀取的範圍/頁籤
        let fetchRange = range;
        let sheetType = 'default';

        if (cleanId === specialSheetId) {
          try {
            // 先嘗試取得試算表資訊，確認頁籤名稱
            const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: cleanId });
            const sheetNames = spreadsheet.data.sheets?.map(s => s.properties?.title) || [];
            console.log(`Available sheets in ${cleanId}:`, sheetNames);
            
            // 尋找最接近的名稱
            const exactMatch = sheetNames.find(n => n === '面試結果通知(新)');
            const fuzzyMatch = sheetNames.find(n => n?.includes('面試結果通知'));
            
            if (exactMatch) {
              fetchRange = `'${exactMatch}'!A:ZZ`;
              sheetType = 'interview_results';
            } else if (fuzzyMatch) {
              fetchRange = `'${fuzzyMatch}'!A:ZZ`;
              sheetType = 'interview_results';
              console.log(`Fuzzy matched sheet name: ${fuzzyMatch}`);
            }
          } catch (e) {
            console.error("Error getting sheet metadata:", e);
            // 即使獲取資訊失敗，還是依照原定計畫嘗試
            fetchRange = "'面試結果通知(新)'!A:ZZ";
            sheetType = 'interview_results';
          }
        }

        console.log(`Fetching sheet: ${cleanId} (Type: ${sheetType}, Range: ${fetchRange})`);

        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: cleanId,
          range: fetchRange,
        });

        results.push({
          sheetId: cleanId,
          envKey: envKey,
          sheetType: sheetType,
          range: fetchRange,
          rows: response.data.values || []
        });

        // 如果是主表 ID，額外嘗試讀取特定的離職頁籤 (原本的 SHEET_3 資料)
        if (envKey === 'GOOGLE_SHEET_ID') {
          try {
            const resResponse = await sheets.spreadsheets.values.get({
              spreadsheetId: cleanId,
              range: "'離職名單匯整2021.10~'!A:ZZ",
            });
            if (resResponse.data.values && resResponse.data.values.length > 0) {
              results.push({
                sheetId: cleanId,
                envKey: 'SHEET_3', // 標記為 SHEET_3 讓前端邏輯保持一致
                sheetType: 'resignation_list',
                range: "'離職名單匯整2021.10~'!A:ZZ",
                rows: resResponse.data.values
              });
            }
          } catch (resErr: any) {
            console.log(`Note: Optional tab '離職名單匯整2021.10~' not found in ${cleanId}`);
          }
        }
      } catch (err: any) {
        console.error(`Error fetching sheet ${sheetId}:`, err.message);
        // 如果指定頁籤讀取失敗，嘗試讀取預設範圍
        if (err.message.includes('not found') || err.message.includes('A1 notation')) {
           try {
             let cleanId = sheetId;
             const match = cleanId.match(/\/d\/([^/]+)/);
             if (match) cleanId = match[1];

             const fallbackResponse = await sheets.spreadsheets.values.get({
               spreadsheetId: cleanId,
               range: "A:ZZ",
             });
             results.push({
               sheetId: cleanId,
               envKey: envKey,
               sheetType: 'default',
               range: 'A:ZZ',
               rows: fallbackResponse.data.values || []
             });
           } catch (fallbackErr) {
             console.error(`Fallback failed for ${sheetId}`);
           }
        }
      }
    }

    // 將所有列合併成一個大陣列，以保持與前端舊邏輯的相容性 (如果前端沒準備好處理多個 dataset)
    // 但我們也回傳一個 results 陣列供現代前端使用
    const allRows = results.flatMap(r => r.rows);

    return res.status(200).json({ 
      rowCount: allRows.length,
      rows: allRows,
      results: results
    });
  } catch (error: any) {
    console.error("Google API Error:", error);
    const msg = error.response?.data?.error?.message || error.message || "讀取試算表失敗";
    return res.status(500).json({ error: `同步失敗: ${msg}` });
  }
}
