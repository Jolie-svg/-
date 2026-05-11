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
    let { sheetId } = req.body;
    if (!sheetId) return res.status(400).json({ error: "Missing sheetId" });

    // Extract ID if a full URL was provided
    const match = sheetId.match(/\/d\/([^/]+)/);
    if (match) sheetId = match[1];

    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    // Note: Vercel environment variables might need the \n replacement
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!clientEmail || !privateKey) {
      console.error("Missing Service Account credentials in environment");
      return res.status(500).json({ 
        error: "伺服器未正確設定 Google Service Account。請在 Vercel 設定 GOOGLE_SERVICE_ACCOUNT_EMAIL 與 GOOGLE_PRIVATE_KEY。" 
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
      
      console.log(`Fetching from Google Sheets via Service Account for ID: ${sheetId}`);
      
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: range,
      });

      const rows = response.data.values || [];
      res.json({ 
        message: "Data synced successfully", 
        rowCount: rows.length,
        rows: rows
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
