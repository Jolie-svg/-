import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON parsing middleware
  app.use(express.json());

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Google Sheets Sync Proxy
  app.post("/api/sync-sheets", async (req, res) => {
    let { sheetId } = req.body;
    if (!sheetId) return res.status(400).json({ error: "Missing sheetId" });

    // Extract ID if a full URL was provided
    const match = sheetId.match(/\/d\/([^/]+)/);
    if (match) sheetId = match[1];

    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
      const response = await fetch(csvUrl);
      
      if (!response.ok) {
        if (response.status === 404) throw new Error("找不到試算表，請確認 ID 是否正確。");
        if (response.status === 403) throw new Error("權限不足，請將 Google Sheet 設定為「知道連結的人均可查看」。");
        throw new Error(`Google 回傳錯誤: ${response.statusText}`);
      }
      
      const csvData = await response.text();
      if (csvData.includes("<!DOCTYPE html>")) {
         throw new Error("同步失敗：該試算表可能未公開，請確認共享設定。");
      }

      // Robust CSV splitting that handles commas within quotes
      const parseCSV = (text: string) => {
        const rows: string[][] = [];
        let row: string[] = [];
        let field = '';
        let inQuotes = false;
        
        for (let i = 0; i < text.length; i++) {
          const char = text[i];
          const nextChar = text[i + 1];
          
          if (inQuotes) {
            if (char === '"' && nextChar === '"') {
              field += '"';
              i++; // skip next quote
            } else if (char === '"') {
              inQuotes = false;
            } else {
              field += char;
            }
          } else {
            if (char === '"') {
              inQuotes = true;
            } else if (char === ',') {
              row.push(field.trim());
              field = '';
            } else if (char === '\n' || char === '\r') {
              row.push(field.trim());
              if (row.length > 0 || field !== '') {
                rows.push(row);
              }
              row = [];
              field = '';
              if (char === '\r' && nextChar === '\n') {
                i++; // skip \n
              }
            } else {
              field += char;
            }
          }
        }
        
        // Push last field/row if exists
        if (field !== '' || row.length > 0) {
          row.push(field.trim());
          rows.push(row);
        }
        
        return rows;
      };

      const rows = parseCSV(csvData);
      
      res.json({ 
        message: "Data fetched successfully", 
        rowCount: rows.length,
        rows: rows
      });
    } catch (error) {
      console.error("Sync Error:", error);
      res.status(500).json({ error: (error as Error).message });
    }
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
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
