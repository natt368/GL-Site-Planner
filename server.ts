import express from "express";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { createServer as createViteServer } from "vite";
import { generateBinDatabase } from "./scripts/parseExcel.js";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for parsing JSON
  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Download Excel Spreadsheet
  app.get("/api/bin-specs/download-excel", (req, res) => {
    const excelPath = path.resolve(process.cwd(), "assets/Grain_Bin_Specifications.xlsx");
    if (fs.existsSync(excelPath)) {
      return res.download(excelPath, "Grain_Bin_Specifications.xlsx");
    }
    return res.status(404).json({ success: false, error: "Excel spreadsheet file not found" });
  });

  // Update Verified Cable Lengths in Excel Spreadsheet
  app.post("/api/bin-specs/update-verified-cables", async (req, res) => {
    try {
      const { modelNumber, originalModelNumber, manufacturer, centerCable, radiusCable } = req.body;
      if (!modelNumber && !originalModelNumber) {
        return res.status(400).json({ success: false, error: "Model number is required" });
      }

      const XLSX = await import("xlsx");
      const excelPath = path.resolve(process.cwd(), "assets/Grain_Bin_Specifications.xlsx");
      if (!fs.existsSync(excelPath)) {
        return res.status(404).json({ success: false, error: "Excel file not found" });
      }

      const wb = XLSX.readFile(excelPath);
      let updated = false;

      for (const sheetName of wb.SheetNames) {
        if (sheetName === "All Bins Summary") continue;
        const sheet = wb.Sheets[sheetName];
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        let headerIdx = -1;
        if (rows[2] && Array.isArray(rows[2]) && rows[2].some((c: any) => typeof c === "string" && c.includes("Standard Model"))) {
          headerIdx = 2;
        } else {
          for (let i = 0; i < Math.min(10, rows.length); i++) {
            const r = rows[i] || [];
            if (Array.isArray(r) && r.some((c: any) => typeof c === "string" && c.includes("Standard Model"))) {
              headerIdx = i;
              break;
            }
          }
        }
        if (headerIdx === -1) continue;

        const headers = rows[headerIdx].map((h: any) => String(h || "").trim());
        let centerColIdx = headers.indexOf("Verified Center Cable Length (ft)");
        let radiusColIdx = headers.indexOf("Verified Radius Cable Length (ft)");

        if (centerColIdx === -1) {
          headers.push("Verified Center Cable Length (ft)");
          centerColIdx = headers.length - 1;
          rows[headerIdx][centerColIdx] = "Verified Center Cable Length (ft)";
        }
        if (radiusColIdx === -1) {
          headers.push("Verified Radius Cable Length (ft)");
          radiusColIdx = headers.length - 1;
          rows[headerIdx][radiusColIdx] = "Verified Radius Cable Length (ft)";
        }

        const stdModelColIdx = headers.findIndex((h) => h.includes("Standard Model"));
        const origModelColIdx = headers.findIndex((h) => h.includes("Original Model"));

        const targetStd = modelNumber ? String(modelNumber).trim() : "";
        const targetOrig = originalModelNumber ? String(originalModelNumber).trim() : "";

        for (let rIdx = headerIdx + 1; rIdx < rows.length; rIdx++) {
          const row = rows[rIdx];
          if (!row) continue;
          const stdModel = stdModelColIdx !== -1 ? String(row[stdModelColIdx] || "").trim() : "";
          const origModel = origModelColIdx !== -1 ? String(row[origModelColIdx] || "").trim() : "";

          if (
            (targetStd && stdModel === targetStd) ||
            (targetOrig && origModel === targetOrig) ||
            (targetStd && origModel === targetStd)
          ) {
            row[centerColIdx] = centerCable || "";
            row[radiusColIdx] = radiusCable || "";
            updated = true;
          }
        }

        wb.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(rows);
      }

      if (updated) {
        XLSX.writeFile(wb, excelPath);
        // Regenerate JSON database
        const binSpecs = generateBinDatabase();
        return res.json({ success: true, count: binSpecs.length, message: "Excel spreadsheet updated successfully" });
      } else {
        return res.json({ success: false, message: "No matching model row found in Excel" });
      }
    } catch (err: any) {
      console.error("Error updating verified cables in Excel:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Dynamically serve parsed bin specs from Excel asset with static JSON fallback
  app.get("/api/bin-specs", async (req, res) => {
    try {
      const excelPath = path.resolve(process.cwd(), "assets/Grain_Bin_Specifications.xlsx");
      if (fs.existsSync(excelPath)) {
        const binSpecs = generateBinDatabase();
        if (binSpecs && binSpecs.length > 0) {
          return res.json({ success: true, count: binSpecs.length, data: binSpecs });
        }
      }
    } catch (err: any) {
      console.error("Error serving bin specs from Excel:", err.message);
    }

    // Fallback to bundled JSON
    try {
      const jsonPath = path.resolve(process.cwd(), "src/data/excelBinDatabase.json");
      if (fs.existsSync(jsonPath)) {
        const jsonContent = fs.readFileSync(jsonPath, "utf-8");
        const binSpecs = JSON.parse(jsonContent);
        return res.json({ success: true, count: binSpecs.length, data: binSpecs });
      }
    } catch (e: any) {
      console.error("Error reading fallback JSON specs:", e.message);
    }

    return res.status(404).json({ success: false, error: "Specs database not found" });
  });

  // Get current git status
  app.get("/api/github/status", (req, res) => {
    exec("git status --porcelain", (error, stdout, stderr) => {
      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
      const lines = stdout.trim().split("\n").filter(Boolean);
      res.json({
        success: true,
        hasChanges: lines.length > 0,
        changes: lines,
      });
    });
  });

  // Push local changes to GitHub
  app.post("/api/github/push", (req, res) => {
    const { commitMessage } = req.body;
    const message = commitMessage ? commitMessage.replace(/"/g, '\\"') : "Sync from AI Studio Manual Button";

    // Run sync.sh helper script to commit and push
    exec(`./sync.sh "${message}"`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error running sync.sh: ${error.message}`);
        return res.status(500).json({
          success: false,
          error: error.message,
          stdout,
          stderr,
        });
      }
      console.log(`sync.sh output: ${stdout}`);
      return res.json({
        success: true,
        stdout,
        stderr,
      });
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
