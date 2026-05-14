import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON parsing middleware
  app.use(express.json());

  // Request logger
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Google Sheets Sync Proxy
  app.post("/api/sync-sheets", async (req, res) => {
    console.log("POST /api/sync-sheets received", req.body);
    
    // Collect all sheet configs from env and request
    const sheetConfigs: { id: string, envKey: string }[] = [];
    
    // 1. Collect from environment variables - specifying keys to avoid picking up API keys
    const allowedEnvKeys = ['GOOGLE_SHEET_ID', 'SHEET_3', '店家面試委員排班'];
    allowedEnvKeys.forEach(key => {
      const val = process.env[key];
      if (val && val.trim() !== '' && !val.startsWith('AIzaSy')) {
        sheetConfigs.push({ id: val.trim(), envKey: key });
      }
    });
    
    // 2. Default fallback if nothing found
    const DEFAULT_SHEET_ID = '1syQgXhAwQV2DLn54gRjsNG1NTLAR59g5hBKzJDK6uh8';
    if (sheetConfigs.length === 0) {
      sheetConfigs.push({ id: DEFAULT_SHEET_ID, envKey: 'GOOGLE_SHEET_ID' });
    }

    // De-duplicate
    const uniqueConfigs = sheetConfigs.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);

    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    let privateKey = process.env.GOOGLE_PRIVATE_KEY;

    if (privateKey) {
      privateKey = privateKey
        .replace(/\\n/g, '\n')
        .replace(/\n/g, '\n')
        .replace(/\r/g, '')
        .replace(/^["']|["']$/g, '')
        .trim();
    }

    if (!clientEmail || !privateKey || !privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      return res.status(500).json({ 
        error: "伺服器環境變數設定錯誤。請檢查 GOOGLE_PRIVATE_KEY 是否包含完整標題。" 
      });
    }

    try {
      const auth = new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
      });

      const sheets = google.sheets({ version: "v4", auth });
      const results: any[] = [];

      for (const config of uniqueConfigs) {
        let sheetId = config.id;
        // Extract ID if a full URL was provided
        const match = sheetId.match(/\/d\/([^/]+)/);
        if (match) sheetId = match[1];

        try {
          // 總是嘗試讀取 A:ZZ (或特定工作表)
          const mainResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: "A:ZZ",
          });
          results.push({
            sheetId: sheetId,
            envKey: config.envKey,
            rows: mainResponse.data.values || []
          });

          // 如果是主表 ID，額外嘗試讀取特定的離職頁籤 (原本的 SHEET_3 資料)
          if (config.envKey === 'GOOGLE_SHEET_ID') {
            try {
              const resResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: "'離職名單匯整2021.10~'!A:ZZ",
              });
              if (resResponse.data.values && resResponse.data.values.length > 0) {
                results.push({
                  sheetId: sheetId,
                  envKey: 'SHEET_3', // 標記為 SHEET_3 讓前端邏輯保持一致
                  rows: resResponse.data.values
                });
              }
            } catch (resErr: any) {
              console.log(`Note: Optional tab '離職名單匯整2021.10~' not found in ${sheetId}`);
            }
          }
        } catch (err: any) {
          console.error(`Error fetching sheet ${sheetId} (${config.envKey}):`, err.message);
        }
      }

      const allRows = results.flatMap(r => r.rows);
      res.json({ 
        message: "Data synced successfully", 
        rowCount: allRows.length,
        rows: allRows,
        results: results
      });
    } catch (error: any) {
      console.error("Google Sheets API Error:", error);
      const msg = error.response?.data?.error?.message || error.message || "無法從 Google Sheets 取得資料";
      res.status(500).json({ error: `同步異常: ${msg}` });
    }
  });

  // Catch-all 404 for /api routes
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`HR System running on http://localhost:${PORT}`);
  });

  // Global Error Handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Unhandled Error:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
