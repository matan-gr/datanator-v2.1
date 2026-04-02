var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/server/etl/extractor.ts
var extractor_exports = {};
__export(extractor_exports, {
  DATA_SOURCES: () => DATA_SOURCES,
  extractFeed: () => extractFeed
});
import Parser from "rss-parser";
import crypto from "crypto";
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
function createParser() {
  return new Parser({
    timeout: 6e4,
    // 60 seconds to handle larger feeds
    customFields: {
      item: ["content:encoded", "description", "pubDate", "updated", "published"]
    },
    headers: {
      "User-Agent": `${getRandomUserAgent()} GCP Datanator/0.9`,
      "Accept": "application/rss+xml, application/rdf+xml, application/atom+xml, application/xml, text/xml, text/html, */*"
    }
  });
}
async function extractFeed(source, retries = 3) {
  const jitter = Math.floor(Math.random() * 2e3);
  await new Promise((resolve) => setTimeout(resolve, jitter));
  let lastError = null;
  let lastStatus = 0;
  let lastStatusText = "";
  let duration = 0;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.debug(`Starting extraction for source: ${source.name} (${source.url}) - Attempt ${attempt}/${retries}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45e3);
      const startTime = Date.now();
      const response = await fetch(source.url, {
        headers: {
          "User-Agent": `${getRandomUserAgent()} GCP Datanator/0.9`,
          "Accept": "application/rss+xml, application/rdf+xml, application/atom+xml, application/xml, text/xml, text/html, */*"
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      duration = Date.now() - startTime;
      lastStatus = response.status;
      lastStatusText = response.statusText;
      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
      }
      const text = await response.text();
      const parser = createParser();
      const feed = await parser.parseString(text);
      console.debug(`Fetched ${feed.items.length} total items from ${source.name}.`);
      const items = feed.items.filter((item) => item.title || item.content || item.description || item["content:encoded"]).map((item) => {
        const uniqueString = item.link ? item.link : item.title || "";
        const deterministicGuid = crypto.createHash("sha256").update(uniqueString).digest("hex");
        return {
          title: item.title,
          link: item.link,
          pubDate: item.pubDate || item.updated || item.published,
          content: item["content:encoded"] || item.content || item.description,
          contentSnippet: item.contentSnippet,
          guid: item.guid || item.id || deterministicGuid
        };
      });
      return {
        items,
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        duration
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`Attempt ${attempt} failed to extract feed ${source.name}:`, error);
      if (attempt === retries) {
        throw new Error(`Failed to extract feed ${source.name} after ${retries} attempts: HTTP ${lastStatus} ${lastStatusText} - ${lastError.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1e3));
    }
  }
  return { items: [], status: lastStatus, statusText: lastStatusText, url: source.url, duration };
}
var USER_AGENTS, DATA_SOURCES;
var init_extractor = __esm({
  "src/server/etl/extractor.ts"() {
    USER_AGENTS = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ];
    DATA_SOURCES = [
      { id: "cloud-blog-main", name: "Cloud Blog - Main", url: "https://cloudblog.withgoogle.com/rss/", type: "rss" },
      { id: "medium-blog", name: "Medium Blog", url: "https://medium.com/feed/google-cloud", type: "rss" },
      { id: "cloud-innovation", name: "Google Cloud Innovation", url: "https://blog.google/innovation-and-ai/infrastructure-and-cloud/google-cloud/rss/", type: "rss" },
      { id: "ai-technology", name: "Google AI Technology", url: "https://blog.google/innovation-and-ai/technology/ai/rss/", type: "rss" },
      { id: "release-notes", name: "Release Notes & Deprecations", url: "https://cloud.google.com/feeds/gcp-release-notes.xml", type: "rss" },
      { id: "ai-research", name: "Google AI Research", url: "http://googleaiblog.blogspot.com/atom.xml?max-results=1000", type: "atom" },
      { id: "gemini-workspace", name: "Gemini & Workspace", url: "https://workspaceupdates.googleblog.com/feeds/posts/default?max-results=1000", type: "atom" },
      { id: "service-health", name: "Service Health (Incidents)", url: "https://status.cloud.google.com/feed.atom", type: "atom" },
      { id: "security-bulletins", name: "Security Bulletins", url: "https://cloud.google.com/feeds/google-cloud-security-bulletins.xml", type: "rss" },
      { id: "terraform-provider", name: "Terraform Provider (IaC Releases)", url: "https://github.com/hashicorp/terraform-provider-google/releases.atom", type: "atom" }
    ];
  }
});

// server.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import path4 from "path";
import { fileURLToPath } from "url";

// src/server/db/sqlite.ts
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import fs from "fs";
var db;
async function initDb() {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = path.join(dataDir, "gcp-datanator.db");
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    await db.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 10000;
      PRAGMA auto_vacuum = INCREMENTAL;
      PRAGMA foreign_keys = ON;
    `);
  } else {
    await db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 10000;
      PRAGMA auto_vacuum = INCREMENTAL;
      PRAGMA foreign_keys = ON;
    `);
  }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS SchemaMigrations (
      version INTEGER PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const hasSyncRuns = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='SyncRuns'");
  const hasV1Migration = await db.get("SELECT version FROM SchemaMigrations WHERE version = 1");
  if (hasSyncRuns && !hasV1Migration) {
    await db.run("INSERT OR IGNORE INTO SchemaMigrations (version) VALUES (1)");
  }
  const migrations = [
    {
      version: 1,
      up: `
        CREATE TABLE IF NOT EXISTS SyncRuns (
          id TEXT PRIMARY KEY,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          status TEXT,
          totalFilesGenerated INTEGER DEFAULT 0,
          totalItemsParsed INTEGER DEFAULT 0,
          errorSummary TEXT,
          triggerType TEXT
        );

        CREATE TABLE IF NOT EXISTS SourceMetrics (
          id TEXT PRIMARY KEY,
          sourceName TEXT,
          sourceUrl TEXT,
          lastSyncTimestamp DATETIME,
          itemsParsedLastSync INTEGER DEFAULT 0,
          healthStatus TEXT,
          lastErrorMessage TEXT
        );

        CREATE TABLE IF NOT EXISTS AppLogs (
          id TEXT PRIMARY KEY,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          level TEXT,
          message TEXT,
          syncRunId TEXT,
          metadata TEXT
        );

        CREATE TABLE IF NOT EXISTS ParsedItems (
          guid TEXT PRIMARY KEY,
          sourceId TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS Settings (
          key TEXT PRIMARY KEY,
          value TEXT,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `
    }
    // Example of future migration:
    // {
    //   version: 2,
    //   up: `ALTER TABLE Settings ADD COLUMN description TEXT;`
    // }
  ];
  for (const migration of migrations) {
    let isApplied = await db.get("SELECT version FROM SchemaMigrations WHERE version = ?", migration.version);
    if (!isApplied) {
      console.log(`Applying database migration v${migration.version}...`);
      await db.exec("BEGIN IMMEDIATE TRANSACTION");
      try {
        isApplied = await db.get("SELECT version FROM SchemaMigrations WHERE version = ?", migration.version);
        if (!isApplied) {
          await db.exec(migration.up);
          await db.run("INSERT INTO SchemaMigrations (version) VALUES (?)", migration.version);
          await db.exec("COMMIT");
          console.log(`Migration v${migration.version} applied successfully.`);
        } else {
          await db.exec("COMMIT");
          console.log(`Migration v${migration.version} was already applied by another instance.`);
        }
      } catch (error) {
        await db.exec("ROLLBACK");
        console.error(`Failed to apply migration v${migration.version}:`, error);
        throw error;
      }
    }
  }
  const defaultSettings = [
    { key: "logRetentionDays", value: "0" }
    // 0 means Forever
  ];
  for (const setting of defaultSettings) {
    await db.run("INSERT OR IGNORE INTO Settings (key, value) VALUES (?, ?)", setting.key, setting.value);
  }
}
function getDb() {
  if (!db) throw new Error("Database not initialized");
  return db;
}
async function closeDb() {
  if (db) {
    await db.close();
    console.log("Database connection closed gracefully.");
  }
}

// src/server/api/routes.ts
import { Router } from "express";
import fs3 from "fs";
import path3 from "path";
import archiver from "archiver";
import { Storage } from "@google-cloud/storage";
import { OAuth2Client } from "google-auth-library";

// src/server/etl/pipeline.ts
import { v4 as uuidv4 } from "uuid";
init_extractor();

// src/server/etl/transformer.ts
import sanitizeHtml from "sanitize-html";
import { parseISO } from "date-fns";
function transformItems(items, source) {
  const seenGuids = /* @__PURE__ */ new Set();
  const transformed = [];
  for (const item of items) {
    if (!item.guid || seenGuids.has(item.guid)) continue;
    seenGuids.add(item.guid);
    let pubDate = /* @__PURE__ */ new Date();
    if (item.pubDate) {
      const parsedDate = new Date(item.pubDate);
      if (!isNaN(parsedDate.getTime())) {
        pubDate = parsedDate;
      } else {
        const isoDate = parseISO(item.pubDate);
        if (!isNaN(isoDate.getTime())) {
          pubDate = isoDate;
        }
      }
    }
    const rawContent = item.content || item.contentSnippet || "";
    const cleanBody = sanitizeHtml(rawContent, {
      allowedTags: [],
      // Strip all HTML tags
      allowedAttributes: {},
      textFilter: (text) => text.replace(/\n+/g, "\n").trim()
    });
    transformed.push({
      title: item.title?.trim() || "Untitled",
      date: pubDate.toISOString(),
      url: item.link || "",
      body: cleanBody,
      guid: item.guid
    });
  }
  return transformed;
}
function formatDocument(items, source, runId) {
  const header = `

=========================================
Sync Run: ${runId}
Date: ${(/* @__PURE__ */ new Date()).toISOString()}
Source: ${source.name}
New Items: ${items.length}
=========================================

`;
  const body = items.map((item) => `---
Title: ${item.title}
Date: ${item.date}
URL: ${item.url}

${item.body}
`).join("\n\n");
  return header + body;
}

// src/server/etl/loader.ts
import fs2 from "fs";
import path2 from "path";
async function saveLocally(content, source, runId) {
  const baseDataDir = process.env.DATA_DIR || path2.join(process.cwd(), "data");
  const dataDir = path2.join(baseDataDir, "feeds");
  if (!fs2.existsSync(dataDir)) {
    fs2.mkdirSync(dataDir, { recursive: true });
  }
  const fileName = `${source.id}.txt`;
  const filePath = path2.join(dataDir, fileName);
  const backupPath = `${filePath}.bak`;
  const tempPath = `${filePath}.tmp`;
  try {
    if (fs2.existsSync(filePath)) {
      fs2.copyFileSync(filePath, backupPath);
    }
    if (fs2.existsSync(filePath)) {
      fs2.copyFileSync(filePath, tempPath);
      fs2.appendFileSync(tempPath, content, "utf8");
    } else {
      fs2.writeFileSync(tempPath, content, "utf8");
    }
    fs2.renameSync(tempPath, filePath);
    console.debug(`Successfully appended to local file: ${filePath}`);
    if (fs2.existsSync(backupPath)) {
      fs2.unlinkSync(backupPath);
    }
    return filePath;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : void 0;
    console.error(`[LOADER ERROR] Failed to save local file for source: ${source.name} (${source.id})`);
    console.error(`[LOADER ERROR] Target Path: ${filePath}`);
    console.error(`[LOADER ERROR] Temp Path: ${tempPath}`);
    console.error(`[LOADER ERROR] Backup Path: ${backupPath}`);
    console.error(`[LOADER ERROR] FS Error Message: ${errorMessage}`);
    if (errorStack) {
      console.error(`[LOADER ERROR] Stack Trace: ${errorStack}`);
    }
    if (fs2.existsSync(backupPath)) {
      try {
        fs2.copyFileSync(backupPath, filePath);
        console.debug(`Restored backup for ${filePath} after failure.`);
      } catch (restoreError) {
        const restoreErrorMessage = restoreError instanceof Error ? restoreError.message : String(restoreError);
        console.error(`[LOADER CRITICAL] Failed to restore backup for ${filePath}. Error: ${restoreErrorMessage}`);
      }
    }
    if (fs2.existsSync(tempPath)) {
      try {
        fs2.unlinkSync(tempPath);
      } catch (unlinkError) {
        const unlinkErrorMessage = unlinkError instanceof Error ? unlinkError.message : String(unlinkError);
        console.error(`[LOADER ERROR] Failed to delete temp file ${tempPath}. Error: ${unlinkErrorMessage}`);
      }
    }
    throw new Error(`Local save failed for ${source.name} at ${filePath}: ${errorMessage}`);
  }
}

// src/server/etl/pipeline.ts
async function logAppEvent(db2, level, message, syncRunId, metadata) {
  const parsedMeta = metadata ? JSON.parse(metadata) : void 0;
  if (level === "ERROR") {
    console.error(`[${syncRunId}] ${message}`, parsedMeta || "");
  } else if (level === "WARN") {
    console.warn(`[${syncRunId}] ${message}`, parsedMeta || "");
  } else {
    console.log(`[${level}] [${syncRunId}] ${message}`, parsedMeta || "");
  }
  const logId = uuidv4();
  if (metadata) {
    await db2.run(
      "INSERT INTO AppLogs (id, level, message, syncRunId, metadata) VALUES (?, ?, ?, ?, ?)",
      [logId, level, message, syncRunId, metadata]
    );
  } else {
    await db2.run(
      "INSERT INTO AppLogs (id, level, message, syncRunId) VALUES (?, ?, ?, ?)",
      [logId, level, message, syncRunId]
    );
  }
  try {
    await db2.run(`
      DELETE FROM AppLogs 
      WHERE id NOT IN (
        SELECT id FROM AppLogs ORDER BY timestamp DESC LIMIT 500
      )
    `);
  } catch (e) {
    console.error("Failed to enforce AppLogs cap:", e);
  }
}
async function runSync(triggerType, sourceId, force = false, wait = false) {
  const db2 = getDb();
  await db2.run(`
    UPDATE SyncRuns 
    SET status = 'FAILED', errorSummary = 'Killed due to server restart or timeout' 
    WHERE status = 'RUNNING' AND timestamp < datetime('now', '-30 minutes')
  `);
  const existingRunning = await db2.get("SELECT id FROM SyncRuns WHERE status = 'RUNNING' LIMIT 1");
  if (existingRunning && !force) {
    console.warn(`Sync already running with ID: ${existingRunning.id}. Skipping.`);
    return existingRunning.id;
  }
  const runId = uuidv4();
  await db2.run(
    "INSERT INTO SyncRuns (id, status, triggerType) VALUES (?, ?, ?)",
    [runId, "RUNNING", triggerType]
  );
  const syncProcess = async () => {
    try {
      const sourcesToSync = sourceId ? DATA_SOURCES.filter((s) => s.id === sourceId) : DATA_SOURCES;
      const results = [];
      for (const source of sourcesToSync) {
        try {
          const { items: rawItems, status, statusText, url, duration } = await extractFeed(source);
          await logAppEvent(
            db2,
            "NETWORK",
            `Source ${source.name}: HTTP ${status} ${statusText} from ${url}`,
            runId,
            JSON.stringify({ status, statusText, url, method: "GET", duration })
          );
          const incomingGuids = rawItems.map((item) => item.guid).filter(Boolean);
          let existingGuidSet = /* @__PURE__ */ new Set();
          if (incomingGuids.length > 0) {
            const chunkSize = 900;
            for (let i = 0; i < incomingGuids.length; i += chunkSize) {
              const chunk = incomingGuids.slice(i, i + chunkSize);
              const placeholders = chunk.map(() => "?").join(",");
              const query = `SELECT guid FROM ParsedItems WHERE sourceId = ? AND guid IN (${placeholders})`;
              const existingGuids = await db2.all(query, [source.id, ...chunk]);
              existingGuids.forEach((r) => existingGuidSet.add(r.guid));
            }
          }
          const newRawItems = rawItems.filter((item) => item.guid && !existingGuidSet.has(item.guid));
          const totalFetched = rawItems.length;
          const duplicates = totalFetched - newRawItems.length;
          if (duplicates > 0) {
            await logAppEvent(
              db2,
              "INFO",
              `Skipped ${duplicates} already parsed items for source: ${source.name}`,
              runId
            );
          }
          await logAppEvent(
            db2,
            "INFO",
            `Source ${source.name}: Fetched ${totalFetched} items. Processing ${newRawItems.length} new items.`,
            runId
          );
          const transformedItems = transformItems(newRawItems, source);
          const itemsCount = transformedItems.length;
          let filesCount = 0;
          if (itemsCount > 0) {
            await db2.exec("BEGIN TRANSACTION");
            try {
              const stmt = await db2.prepare("INSERT OR IGNORE INTO ParsedItems (guid, sourceId) VALUES (?, ?)");
              for (const item of transformedItems) {
                await stmt.run([item.guid, source.id]);
              }
              await stmt.finalize();
              await db2.exec("COMMIT");
            } catch (dbError) {
              await db2.exec("ROLLBACK");
              throw new Error(`Database update failed: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
            }
            try {
              const documentContent = formatDocument(transformedItems, source, runId);
              await saveLocally(documentContent, source, runId);
              filesCount = 1;
            } catch (fileError) {
              throw new Error(`File save failed after DB update: ${fileError instanceof Error ? fileError.message : String(fileError)}`);
            }
          } else {
            try {
              const documentContent = `

--- Sync Run: ${runId} ---
No new items found at ${(/* @__PURE__ */ new Date()).toISOString()}
`;
              await saveLocally(documentContent, source, runId);
              filesCount = 1;
            } catch (fileError) {
              await logAppEvent(
                db2,
                "WARN",
                `Failed to touch file for ${source.name}`,
                runId,
                JSON.stringify({ error: String(fileError) })
              );
            }
          }
          await db2.run(`
            INSERT INTO SourceMetrics (id, sourceName, sourceUrl, lastSyncTimestamp, itemsParsedLastSync, healthStatus)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, 'HEALTHY')
            ON CONFLICT(id) DO UPDATE SET
              lastSyncTimestamp = CURRENT_TIMESTAMP,
              itemsParsedLastSync = excluded.itemsParsedLastSync,
              healthStatus = 'HEALTHY',
              lastErrorMessage = NULL
          `, [source.id, source.name, source.url, itemsCount]);
          await logAppEvent(
            db2,
            "INFO",
            `Successfully synced ${source.name} (${itemsCount} items)`,
            runId
          );
          results.push({ success: true, items: itemsCount, files: filesCount });
        } catch (error) {
          await db2.run(`
            INSERT INTO SourceMetrics (id, sourceName, sourceUrl, lastSyncTimestamp, healthStatus, lastErrorMessage)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, 'FAILING', ?)
            ON CONFLICT(id) DO UPDATE SET
              lastSyncTimestamp = CURRENT_TIMESTAMP,
              healthStatus = 'FAILING',
              lastErrorMessage = excluded.lastErrorMessage
          `, [source.id, source.name, source.url, String(error)]);
          const errorStack = error instanceof Error ? error.stack : void 0;
          await logAppEvent(
            db2,
            "ERROR",
            `Failed to sync ${source.name}`,
            runId,
            JSON.stringify({ error: String(error), stack: errorStack })
          );
          results.push({ success: false, items: 0, files: 0, error: `${source.name}: ${String(error)}` });
        }
      }
      const totalItems = results.reduce((sum, r) => sum + r.items, 0);
      const totalFiles = results.reduce((sum, r) => sum + r.files, 0);
      const errors = results.filter((r) => !r.success).map((r) => r.error);
      const finalStatus = errors.length === 0 ? "SUCCESS" : errors.length < sourcesToSync.length ? "PARTIAL_SUCCESS" : "FAILED";
      const errorSummary = errors.length > 0 ? errors.join(" | ") : null;
      await db2.run(
        "UPDATE SyncRuns SET status = ?, totalFilesGenerated = ?, totalItemsParsed = ?, errorSummary = ? WHERE id = ?",
        [finalStatus, totalFiles, totalItems, errorSummary, runId]
      );
      try {
        const retentionSetting = await db2.get("SELECT value FROM Settings WHERE key = 'logRetentionDays'");
        const retentionDays = parseInt(retentionSetting?.value || "30");
        if (retentionDays > 0) {
          const cleanupDate = /* @__PURE__ */ new Date();
          cleanupDate.setDate(cleanupDate.getDate() - retentionDays);
          const cleanupDateStr = cleanupDate.toISOString().replace("T", " ").substring(0, 19);
          await db2.run("DELETE FROM AppLogs WHERE timestamp < ?", cleanupDateStr);
          await db2.run("DELETE FROM SyncRuns WHERE timestamp < ? AND status != 'RUNNING'", cleanupDateStr);
          await db2.run("DELETE FROM ParsedItems WHERE timestamp < ?", cleanupDateStr);
          await db2.exec("PRAGMA incremental_vacuum");
          await db2.exec("PRAGMA optimize");
          await logAppEvent(
            db2,
            "INFO",
            `Cleanup completed. Removed DB records older than ${retentionDays} days. Vacuumed and optimized DB.`,
            runId
          );
          console.log(`Cleanup completed. Removed data older than ${retentionDays} days (${cleanupDateStr}).`);
        }
      } catch (cleanupError) {
        await logAppEvent(
          db2,
          "ERROR",
          "Failed to perform automatic cleanup",
          runId,
          JSON.stringify({ error: String(cleanupError) })
        );
      }
    } catch (fatalError) {
      await db2.run(
        "UPDATE SyncRuns SET status = ?, errorSummary = ? WHERE id = ?",
        ["FAILED", `Fatal error: ${fatalError instanceof Error ? fatalError.message : String(fatalError)}`, runId]
      );
      await logAppEvent(
        db2,
        "ERROR",
        `Fatal pipeline error`,
        runId,
        JSON.stringify({ error: String(fatalError) })
      );
    }
  };
  if (wait) {
    await syncProcess();
  } else {
    syncProcess().catch((err) => {
      console.error(`Fatal error in background sync process ${runId}:`, err);
    });
  }
  return runId;
}

// src/server/api/validation.ts
import { z } from "zod";
var SettingUpdateSchema = z.object({
  key: z.string().min(1, "Key is required"),
  value: z.string().min(1, "Value is required")
});
var GCSExportSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  bucketName: z.string().min(1, "Bucket name is required"),
  authCode: z.string().optional(),
  accessToken: z.string().optional()
}).refine((data) => data.authCode || data.accessToken, {
  message: "Either authCode or accessToken must be provided",
  path: ["authCode"]
});

// src/server/api/routes.ts
import { z as z2 } from "zod";
var apiRouter = Router();
var handleError = (res, error, defaultMessage) => {
  console.error(`${defaultMessage}:`, error);
  if (error instanceof z2.ZodError) {
    return res.status(400).json({
      success: false,
      error: "Validation failed",
      details: error.issues.map((e) => ({ path: e.path, message: e.message }))
    });
  }
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : void 0;
  res.status(500).json({
    success: false,
    error: errorMessage,
    stack: process.env.NODE_ENV !== "production" ? errorStack : void 0,
    details: defaultMessage
  });
};
var validate = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (error) {
    handleError(res, error, "Validation Error");
  }
};
apiRouter.get("/readme", async (req, res) => {
  try {
    const readmePath = path3.join(process.cwd(), "README.md");
    if (fs3.existsSync(readmePath)) {
      const content = fs3.readFileSync(readmePath, "utf8");
      res.json({ success: true, content });
    } else {
      res.status(404).json({ success: false, error: "README.md not found" });
    }
  } catch (error) {
    handleError(res, error, "Failed to fetch README");
  }
});
apiRouter.get("/gemini/content", async (req, res) => {
  try {
    const dataDir = path3.join(process.env.DATA_DIR || path3.join(process.cwd(), "data"), "feeds");
    if (!fs3.existsSync(dataDir)) {
      return res.json({ success: true, content: "" });
    }
    const files = fs3.readdirSync(dataDir).filter((f) => f.endsWith(".txt"));
    let combinedContent = "";
    for (const file of files) {
      try {
        const filePath = path3.join(dataDir, file);
        const stats = fs3.statSync(filePath);
        const readSize = Math.min(stats.size, 1048576);
        if (readSize > 0) {
          const buffer = Buffer.alloc(readSize);
          const fd = fs3.openSync(filePath, "r");
          fs3.readSync(fd, buffer, 0, readSize, stats.size - readSize);
          fs3.closeSync(fd);
          combinedContent += `

--- Source: ${file} ---
${buffer.toString("utf8")}`;
        }
      } catch (fileError) {
        console.warn(`Failed to read file ${file} for Gemini content:`, fileError);
      }
    }
    res.json({ success: true, content: combinedContent.trim() });
  } catch (error) {
    handleError(res, error, "Failed to fetch Gemini content");
  }
});
apiRouter.get("/analytics", async (req, res) => {
  try {
    const db2 = getDb();
    const [runsStats, sourceStats, itemsStats] = await Promise.all([
      db2.get(`
        SELECT 
          COUNT(*) as totalRuns,
          SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as successfulRuns,
          SUM(totalFilesGenerated) as totalFiles,
          SUM(totalItemsParsed) as totalItems
        FROM SyncRuns
      `),
      db2.get('SELECT COUNT(*) as totalSources, SUM(CASE WHEN healthStatus = "HEALTHY" THEN 1 ELSE 0 END) as healthySources FROM SourceMetrics'),
      db2.get("SELECT COUNT(*) as uniqueItems FROM ParsedItems")
    ]);
    const successRate = runsStats.totalRuns > 0 ? Math.round(runsStats.successfulRuns / runsStats.totalRuns * 100) : 0;
    res.json({
      success: true,
      data: {
        totalRuns: runsStats.totalRuns || 0,
        successRate,
        totalFiles: runsStats.totalFiles || 0,
        totalItems: runsStats.totalItems || 0,
        uniqueItems: itemsStats.uniqueItems || 0,
        totalSources: sourceStats.totalSources || 0,
        healthySources: sourceStats.healthySources || 0
      }
    });
  } catch (error) {
    handleError(res, error, "Failed to fetch analytics");
  }
});
apiRouter.all("/sync/monthly", async (req, res) => {
  try {
    const triggerType = req.body?.triggerType || req.query?.triggerType || (req.method === "GET" ? "SCHEDULED" : "MANUAL");
    const force = req.body?.force || req.query?.force === "true" || false;
    const wait = req.body?.wait || req.query?.wait === "true" || req.method === "GET" || false;
    const runId = await runSync(triggerType, void 0, force, wait);
    res.json({ success: true, runId, message: "Monthly sync triggered successfully" });
  } catch (error) {
    handleError(res, error, "Monthly sync failed");
  }
});
apiRouter.post("/sync/targeted", async (req, res) => {
  const { sourceId, force, wait } = req.body;
  try {
    if (!sourceId) {
      return res.status(400).json({ success: false, error: "sourceId is required" });
    }
    const runId = await runSync("MANUAL", sourceId, force, wait);
    res.json({ success: true, runId, message: "Targeted sync triggered successfully" });
  } catch (error) {
    handleError(res, error, "Targeted sync failed");
  }
});
apiRouter.post("/sync/test", async (req, res) => {
  const { sourceId } = req.body;
  try {
    if (!sourceId) {
      return res.status(400).json({ success: false, error: "sourceId is required" });
    }
    const { DATA_SOURCES: DATA_SOURCES2, extractFeed: extractFeed2 } = await Promise.resolve().then(() => (init_extractor(), extractor_exports));
    const source = DATA_SOURCES2.find((s) => s.id === sourceId);
    if (!source) {
      return res.status(404).json({ success: false, error: "Source not found" });
    }
    const result = await extractFeed2(source, 1);
    res.json({ success: true, message: `Successfully connected. Found ${result.items.length} items.` });
  } catch (error) {
    handleError(res, error, "Connection test failed");
  }
});
apiRouter.get("/sync-runs", async (req, res) => {
  try {
    const db2 = getDb();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const countResult = await db2.get("SELECT COUNT(*) as total FROM SyncRuns");
    const total = countResult.total;
    const runs = await db2.all("SELECT * FROM SyncRuns ORDER BY timestamp DESC LIMIT ? OFFSET ?", limit, offset);
    res.json({ success: true, data: runs, total, page, limit });
  } catch (error) {
    handleError(res, error, "Failed to fetch sync runs");
  }
});
apiRouter.get("/source-metrics", async (req, res) => {
  try {
    const db2 = getDb();
    const metrics = await db2.all("SELECT * FROM SourceMetrics ORDER BY sourceName ASC");
    res.json({ success: true, data: metrics });
  } catch (error) {
    handleError(res, error, "Failed to fetch source metrics");
  }
});
apiRouter.get("/logs", async (req, res) => {
  try {
    const db2 = getDb();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const level = req.query.level;
    const search = req.query.search;
    const excludeLevel = req.query.excludeLevel;
    const syncRunId = req.query.syncRunId;
    let query = "SELECT * FROM AppLogs";
    const params = [];
    const conditions = [];
    if (syncRunId) {
      conditions.push("syncRunId = ?");
      params.push(syncRunId);
    }
    if (level && level !== "ALL") {
      conditions.push("level = ?");
      params.push(level);
    }
    if (excludeLevel) {
      conditions.push("level != ?");
      params.push(excludeLevel);
    }
    if (search) {
      conditions.push("message LIKE ?");
      params.push(`%${search}%`);
    }
    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }
    const countQuery = query.replace("SELECT *", "SELECT COUNT(*) as total");
    const countResult = await db2.get(countQuery, ...params);
    const total = countResult.total;
    query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);
    const logs = await db2.all(query, ...params);
    res.json({ success: true, data: logs, total, page, limit });
  } catch (error) {
    handleError(res, error, "Failed to fetch app logs");
  }
});
apiRouter.get("/system/status", async (req, res) => {
  try {
    const db2 = getDb();
    const dbPath = path3.join(process.env.DATA_DIR || path3.join(process.cwd(), "data"), "gcp-datanator.db");
    const dbStats = fs3.existsSync(dbPath) ? fs3.statSync(dbPath) : { size: 0 };
    const dataDir = path3.join(process.env.DATA_DIR || path3.join(process.cwd(), "data"), "feeds");
    let totalFileSize = 0;
    let fileCount = 0;
    if (fs3.existsSync(dataDir)) {
      const files = fs3.readdirSync(dataDir);
      fileCount = files.length;
      for (const file of files) {
        totalFileSize += fs3.statSync(path3.join(dataDir, file)).size;
      }
    }
    res.json({
      success: true,
      data: {
        dbSize: dbStats.size,
        fileCount,
        totalFileSize,
        geminiKeySet: !!process.env.GEMINI_API_KEY,
        nodeVersion: process.version,
        platform: process.platform,
        uptime: process.uptime()
      }
    });
  } catch (error) {
    handleError(res, error, "Failed to fetch system status");
  }
});
apiRouter.get("/system/settings", async (req, res) => {
  try {
    const db2 = getDb();
    const settings = await db2.all("SELECT * FROM Settings");
    const settingsMap = settings.reduce((acc, s) => {
      acc[s.key] = s.value;
      return acc;
    }, {});
    res.json({ success: true, data: settingsMap });
  } catch (error) {
    handleError(res, error, "Failed to fetch settings");
  }
});
apiRouter.post("/system/settings", validate(SettingUpdateSchema), async (req, res) => {
  const { key, value } = req.body;
  try {
    const db2 = getDb();
    await db2.run("INSERT OR REPLACE INTO Settings (key, value, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)", key, String(value));
    res.json({ success: true, message: `Setting ${key} updated successfully` });
  } catch (error) {
    handleError(res, error, "Failed to update settings");
  }
});
apiRouter.post("/system/purge", async (req, res) => {
  try {
    const db2 = getDb();
    await db2.exec("BEGIN TRANSACTION");
    try {
      await db2.run("DELETE FROM SyncRuns");
      await db2.run("DELETE FROM SourceMetrics");
      await db2.run("DELETE FROM AppLogs");
      await db2.run("DELETE FROM ParsedItems");
      await db2.exec("COMMIT");
    } catch (e) {
      await db2.exec("ROLLBACK");
      throw e;
    }
    const dataDir = path3.join(process.env.DATA_DIR || path3.join(process.cwd(), "data"), "feeds");
    if (fs3.existsSync(dataDir)) {
      try {
        fs3.rmSync(dataDir, { recursive: true, force: true });
      } catch (fileError) {
        console.error(`Failed to delete feeds directory during purge:`, fileError);
      }
    }
    if (!fs3.existsSync(dataDir)) {
      fs3.mkdirSync(dataDir, { recursive: true });
    }
    res.json({ success: true, message: "System purged successfully" });
  } catch (error) {
    handleError(res, error, "Failed to purge system");
  }
});
apiRouter.post("/system/reset", async (req, res) => {
  try {
    const db2 = getDb();
    await db2.exec("BEGIN TRANSACTION");
    try {
      await db2.run("DELETE FROM Settings");
      const defaultSettings = [
        { key: "logRetentionDays", value: "0" }
      ];
      for (const setting of defaultSettings) {
        await db2.run("INSERT INTO Settings (key, value) VALUES (?, ?)", setting.key, setting.value);
      }
      await db2.exec("COMMIT");
    } catch (e) {
      await db2.exec("ROLLBACK");
      throw e;
    }
    res.json({ success: true, message: "Settings reset to defaults" });
  } catch (error) {
    handleError(res, error, "Failed to reset settings");
  }
});
apiRouter.get("/files", async (req, res) => {
  try {
    const dataDir = path3.join(process.env.DATA_DIR || path3.join(process.cwd(), "data"), "feeds");
    if (!fs3.existsSync(dataDir)) {
      return res.json({ success: true, data: [] });
    }
    const files = fs3.readdirSync(dataDir).filter((f) => f.endsWith(".txt"));
    const fileStats = files.map((f) => {
      const stats = fs3.statSync(path3.join(dataDir, f));
      return {
        name: f,
        size: stats.size,
        lastModified: stats.mtime
      };
    });
    fileStats.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    res.json({ success: true, data: fileStats });
  } catch (error) {
    handleError(res, error, "Failed to list files");
  }
});
apiRouter.get("/files/:filename", async (req, res) => {
  try {
    const filename = req.params.filename;
    if (filename.includes("..") || filename.includes("/")) {
      return res.status(400).json({ success: false, error: "Invalid filename" });
    }
    const filePath = path3.join(process.env.DATA_DIR || path3.join(process.cwd(), "data"), "feeds", filename);
    if (!fs3.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: "File not found" });
    }
    if (req.query.download === "1") {
      res.download(filePath);
    } else {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.sendFile(filePath);
    }
  } catch (error) {
    handleError(res, error, "Failed to download file");
  }
});
apiRouter.get("/files-download-all", async (req, res) => {
  try {
    const dataDir = path3.join(process.env.DATA_DIR || path3.join(process.cwd(), "data"), "feeds");
    if (!fs3.existsSync(dataDir)) {
      return res.status(404).json({ success: false, error: "No files to download" });
    }
    const files = fs3.readdirSync(dataDir).filter((f) => f.endsWith(".txt"));
    if (files.length === 0) {
      return res.status(404).json({ success: false, error: "No files to download" });
    }
    const archive = archiver("zip", { zlib: { level: 9 } });
    const zipName = `gcp-datanator-export-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.zip`;
    res.attachment(zipName);
    archive.pipe(res);
    for (const file of files) {
      archive.file(path3.join(dataDir, file), { name: file });
    }
    await archive.finalize();
  } catch (error) {
    handleError(res, error, "Failed to generate ZIP");
  }
});
apiRouter.post("/files-export-gcs", validate(GCSExportSchema), async (req, res) => {
  const { projectId, bucketName, authCode, accessToken } = req.body;
  try {
    const dataDir = path3.join(process.env.DATA_DIR || path3.join(process.cwd(), "data"), "feeds");
    if (!fs3.existsSync(dataDir)) {
      return res.status(404).json({ success: false, error: "No files to export" });
    }
    const files = fs3.readdirSync(dataDir).filter((f) => f.endsWith(".txt"));
    if (files.length === 0) {
      return res.status(404).json({ success: false, error: "No files to export" });
    }
    let finalToken = accessToken;
    if (authCode && !accessToken) {
      const oauth2Client2 = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        "postmessage"
        // Standard for popup-based OAuth
      );
      const { tokens } = await oauth2Client2.getToken(authCode);
      finalToken = tokens.access_token;
    }
    if (!finalToken) {
      return res.status(400).json({ success: false, error: "Failed to obtain access token" });
    }
    const oauth2Client = new OAuth2Client();
    oauth2Client.setCredentials({ access_token: finalToken });
    const storage = new Storage({
      projectId,
      authClient: oauth2Client
    });
    const bucket = storage.bucket(bucketName);
    const [exists] = await bucket.exists();
    if (!exists) {
      return res.status(404).json({ success: false, error: `Bucket ${bucketName} does not exist in project ${projectId}` });
    }
    const uploadPromises = files.map((file) => {
      return bucket.upload(path3.join(dataDir, file), {
        destination: `gcp-datanator-export/${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}/${file}`,
        resumable: false
      });
    });
    const results = await Promise.allSettled(uploadPromises);
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      console.error(`GCS Export: ${failed.length} files failed to upload.`, failed);
      if (failed.length === files.length) {
        return res.status(500).json({ success: false, error: "All file uploads failed. Check server logs." });
      }
      return res.json({
        success: true,
        message: `Exported ${files.length - failed.length} files, but ${failed.length} failed.`
      });
    }
    res.json({
      success: true,
      message: `Successfully exported ${files.length} files to gs://${bucketName}/gcp-datanator-export/`
    });
  } catch (error) {
    handleError(res, error, "GCS Export failed");
  }
});

// server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path4.dirname(__filename);
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});
async function startServer() {
  try {
    const app = express();
    const PORT = 3e3;
    app.use(cors());
    app.use(express.json());
    app.use((req, res, next) => {
      const start = Date.now();
      res.on("finish", () => {
        const duration = Date.now() - start;
        const isPolling = req.originalUrl.includes("/api/v1/sync-runs") || req.originalUrl.includes("/api/v1/metrics") || req.originalUrl.includes("/api/v1/logs");
        const isStaticAsset = req.originalUrl.startsWith("/src/") || req.originalUrl.startsWith("/@") || req.originalUrl.startsWith("/node_modules/") || req.originalUrl.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|tsx|ts|woff|woff2)$/);
        if (isPolling || isStaticAsset) {
          return;
        }
        console.log(`NETWORK: ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
      });
      next();
    });
    await initDb();
    app.use("/api/v1", apiRouter);
    app.use("/api/v1", (req, res) => {
      console.log("HIT 404 handler:", req.method, req.originalUrl);
      res.status(404).json({ success: false, error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
    });
    app.use("/api/v1", (err, req, res, next) => {
      console.error("API Error:", err);
      res.status(500).json({
        success: false,
        error: err.message || "Internal Server Error",
        stack: process.env.NODE_ENV !== "production" ? err.stack : void 0
      });
    });
    if (process.env.NODE_ENV !== "production") {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa"
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path4.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path4.join(distPath, "index.html"));
      });
    }
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
    const gracefulShutdown = async () => {
      console.log("Received kill signal, shutting down gracefully");
      server.close(async () => {
        console.log("Closed out remaining connections");
        await closeDb();
        process.exit(0);
      });
      setTimeout(() => {
        console.error("Could not close connections in time, forcefully shutting down");
        process.exit(1);
      }, 5e3);
    };
    process.on("SIGTERM", gracefulShutdown);
    process.on("SIGINT", gracefulShutdown);
    server.on("error", (error) => {
      console.error("Server error:", error);
      if (error.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use. Exiting...`);
        process.exit(1);
      }
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}
startServer();
