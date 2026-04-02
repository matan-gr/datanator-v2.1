import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import archiver from 'archiver';
import { Storage } from '@google-cloud/storage';
import { OAuth2Client, GoogleAuth } from 'google-auth-library';
import { GoogleGenAI } from "@google/genai";
import { getDb } from '../db/sqlite.ts';
import { runSync } from '../etl/pipeline.ts';
import { v4 as uuidv4 } from 'uuid';
import { 
  SettingUpdateSchema, 
  GCSExportSchema,
  DataSourceSchema
} from './validation.ts';
import { z } from 'zod';

import { logger } from '../utils/logger.ts';

export const apiRouter = Router();

const handleError = (res: any, error: unknown, defaultMessage: string) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;
  
  logger.error(defaultMessage, { error: errorMessage, stack: errorStack });
  
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: error.issues.map(e => ({ path: e.path, message: e.message }))
    });
  }

  res.status(500).json({ 
    success: false, 
    error: errorMessage,
    stack: process.env.NODE_ENV !== 'production' ? errorStack : undefined,
    details: defaultMessage
  });
};

// Validation middleware
const validate = (schema: z.ZodSchema) => (req: any, res: any, next: any) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (error) {
    handleError(res, error, 'Validation Error');
  }
};

// --- Data Sources Endpoints ---

apiRouter.get('/sources', async (req, res) => {
  try {
    const db = getDb();
    const sources = await db.all("SELECT * FROM DataSources WHERE deletedAt IS NULL ORDER BY name ASC");
    res.json({ success: true, data: sources });
  } catch (error) {
    handleError(res, error, 'Failed to fetch sources');
  }
});

apiRouter.post('/sources', validate(DataSourceSchema), async (req, res) => {
  try {
    const db = getDb();
    const { name, url, type, isActive, config } = req.body;
    const id = uuidv4();
    const configStr = config ? JSON.stringify(config) : null;
    
    await db.run(
      `INSERT INTO DataSources (id, name, url, type, origin, isActive, config)
       VALUES (?, ?, ?, ?, 'USER', ?, ?)`,
      [id, name, url, type, isActive !== false ? 1 : 0, configStr]
    );

    await db.run(
      `INSERT INTO ConfigAuditLogs (entityType, entityId, action, changes, user) VALUES (?, ?, ?, ?, ?)`,
      ['DataSource', id, 'CREATE', JSON.stringify({ name, url, type, isActive, config }), 'USER']
    );
    
    res.json({ success: true, message: 'Source created successfully', id });
  } catch (error) {
    handleError(res, error, 'Failed to create source');
  }
});

apiRouter.put('/sources/:id', validate(DataSourceSchema), async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { name, url, type, isActive, config } = req.body;
    const configStr = config ? JSON.stringify(config) : null;
    
    const existing = await db.get("SELECT * FROM DataSources WHERE id = ? AND deletedAt IS NULL", [id]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Source not found' });
    }

    if (existing.origin === 'SYSTEM') {
      // For SYSTEM sources, only isActive can be updated via API
      await db.run(
        `UPDATE DataSources SET isActive = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
        [isActive !== false ? 1 : 0, id]
      );
      await db.run(
        `INSERT INTO ConfigAuditLogs (entityType, entityId, action, changes, user) VALUES (?, ?, ?, ?, ?)`,
        ['DataSource', id, 'UPDATE', JSON.stringify({ isActive }), 'USER']
      );
    } else {
      // For USER sources, everything can be updated
      await db.run(
        `UPDATE DataSources 
         SET name = ?, url = ?, type = ?, isActive = ?, config = ?, updatedAt = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [name, url, type, isActive !== false ? 1 : 0, configStr, id]
      );
      await db.run(
        `INSERT INTO ConfigAuditLogs (entityType, entityId, action, changes, user) VALUES (?, ?, ?, ?, ?)`,
        ['DataSource', id, 'UPDATE', JSON.stringify({ name, url, type, isActive, config }), 'USER']
      );
    }
    
    res.json({ success: true, message: 'Source updated successfully' });
  } catch (error) {
    handleError(res, error, 'Failed to update source');
  }
});

apiRouter.delete('/sources/:id', async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    
    const existing = await db.get("SELECT name, origin FROM DataSources WHERE id = ? AND deletedAt IS NULL", [id]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Source not found' });
    }
    
    if (existing.origin === 'SYSTEM') {
      return res.status(403).json({ success: false, error: 'Cannot delete SYSTEM managed sources from the UI' });
    }
    
    await db.run(`UPDATE DataSources SET deletedAt = CURRENT_TIMESTAMP, isActive = 0 WHERE id = ?`, [id]);
    await db.run(
      `INSERT INTO ConfigAuditLogs (entityType, entityId, action, user) VALUES (?, ?, ?, ?)`,
      ['DataSource', id, 'DELETE', 'USER']
    );

    // Archive the index file so a recreated source with the same name starts fresh
    try {
      const baseDataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
      const dataDir = path.join(baseDataDir, 'feeds');
      const safeSourceName = existing.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const indexPath = path.join(dataDir, `${safeSourceName}.index`);
      if (fs.existsSync(indexPath)) {
        const timestamp = Date.now();
        const archivedPath = path.join(dataDir, `${safeSourceName}.index.archived_${timestamp}`);
        fs.renameSync(indexPath, archivedPath);
      }
    } catch (fsError) {
      logger.warn(`Failed to archive index file for deleted source ${existing.name}`, { error: String(fsError) });
    }

    res.json({ success: true, message: 'Source deleted successfully' });
  } catch (error) {
    handleError(res, error, 'Failed to delete source');
  }
});

apiRouter.post('/sources/:id/reset-circuit', async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    
    await db.run(`UPDATE DataSources SET circuitOpen = 0, consecutiveFailures = 0 WHERE id = ?`, [id]);
    await db.run(
      `INSERT INTO ConfigAuditLogs (entityType, entityId, action, user) VALUES (?, ?, ?, ?)`,
      ['DataSource', id, 'RESET_CIRCUIT', 'USER']
    );
    res.json({ success: true, message: 'Circuit breaker reset successfully' });
  } catch (error) {
    handleError(res, error, 'Failed to reset circuit breaker');
  }
});

// --- End Data Sources Endpoints ---

// Readme endpoint
apiRouter.get('/readme', async (req, res) => {
  try {
    const readmePath = path.join(process.cwd(), 'README.md');
    if (fs.existsSync(readmePath)) {
      const content = fs.readFileSync(readmePath, 'utf8');
      res.json({ success: true, content });
    } else {
      res.status(404).json({ success: false, error: 'README.md not found' });
    }
  } catch (error) {
    handleError(res, error, 'Failed to fetch README');
  }
});

// Gemini Content endpoint (to be used by frontend for generation)
apiRouter.get('/gemini/content', async (req, res) => {
  try {
    const dataDir = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'feeds');
    if (!fs.existsSync(dataDir)) {
      return res.json({ success: true, content: "" });
    }
    
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.txt'));
    let combinedContent = "";
    
    // Read last 1MB of each file to avoid hitting token limits while getting recent data
    // Cap total content to ~3MB to stay well within Gemini token limits
    const MAX_TOTAL_SIZE = 3 * 1024 * 1024; 
    let currentTotalSize = 0;

    for (const file of files) {
      if (currentTotalSize >= MAX_TOTAL_SIZE) break;

      try {
        const filePath = path.join(dataDir, file);
        const stats = fs.statSync(filePath);
        const remainingSpace = MAX_TOTAL_SIZE - currentTotalSize;
        const readSize = Math.min(stats.size, 1048576, remainingSpace); // Max 1MB per file, or remaining space
        
        if (readSize > 0) {
          const buffer = Buffer.alloc(readSize);
          const fd = fs.openSync(filePath, 'r');
          fs.readSync(fd, buffer, 0, readSize, stats.size - readSize);
          fs.closeSync(fd);
          combinedContent += `\n\n--- Source: ${file} ---\n${buffer.toString('utf8')}`;
          currentTotalSize += readSize;
        }
      } catch (fileError) {
        logger.warn(`Failed to read file ${file} for Gemini content:`, { error: String(fileError) });
      }
    }

    res.json({ success: true, content: combinedContent.trim() });
  } catch (error) {
    handleError(res, error, 'Failed to fetch Gemini content');
  }
});

// Analytics endpoint
apiRouter.get('/analytics', async (req, res) => {
  try {
    const db = getDb();
    const [runsStats, sourceStats] = await Promise.all([
      db.get(`
        SELECT 
          COUNT(*) as totalRuns,
          SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as successfulRuns,
          SUM(totalFilesGenerated) as totalFiles,
          SUM(totalItemsParsed) as totalItems
        FROM SyncRuns
      `),
      db.get('SELECT COUNT(*) as totalSources, SUM(CASE WHEN healthStatus = "HEALTHY" THEN 1 ELSE 0 END) as healthySources FROM SourceMetrics')
    ]);

    // Count unique items from .index files
    let uniqueItems = 0;
    try {
      const dataDir = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'feeds');
      if (fs.existsSync(dataDir)) {
        const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.index'));
        for (const file of files) {
          const content = fs.readFileSync(path.join(dataDir, file), 'utf8');
          uniqueItems += content.split('\n').filter(line => line.trim()).length;
        }
      }
    } catch (e) {
      logger.error('Failed to count unique items from index files', { error: String(e) });
    }

    const successRate = runsStats.totalRuns > 0 
      ? Math.round((runsStats.successfulRuns / runsStats.totalRuns) * 100) 
      : 0;

    res.json({
      success: true,
      data: {
        totalRuns: runsStats.totalRuns || 0,
        successRate,
        totalFiles: runsStats.totalFiles || 0,
        totalItems: runsStats.totalItems || 0,
        uniqueItems: uniqueItems,
        totalSources: sourceStats.totalSources || 0,
        healthySources: sourceStats.healthySources || 0
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to fetch analytics');
  }
});

// Trigger full monthly sync
apiRouter.all('/sync/monthly', async (req, res) => {
  try {
    const triggerType = req.body?.triggerType || req.query?.triggerType || (req.method === 'GET' ? 'SCHEDULED' : 'MANUAL');
    const force = req.body?.force || req.query?.force === 'true' || false;
    const wait = req.body?.wait || req.query?.wait === 'true' || req.method === 'GET' || false;
    
    const runId = await runSync(triggerType as any, undefined, force, wait);
    res.json({ success: true, runId, message: 'Monthly sync triggered successfully' });
  } catch (error) {
    handleError(res, error, 'Monthly sync failed');
  }
});

// Trigger targeted sync for debugging
apiRouter.post('/sync/targeted', async (req, res) => {
  const { sourceId, force, wait } = req.body;
  try {
    if (!sourceId) {
      return res.status(400).json({ success: false, error: 'sourceId is required' });
    }
    const runId = await runSync('MANUAL', sourceId, force, wait);
    res.json({ success: true, runId, message: 'Targeted sync triggered successfully' });
  } catch (error) {
    handleError(res, error, 'Targeted sync failed');
  }
});

// Test connection to a specific source
apiRouter.post('/sync/test', async (req, res) => {
  const { sourceId } = req.body;
  try {
    if (!sourceId) {
      return res.status(400).json({ success: false, error: 'sourceId is required' });
    }
    const db = getDb();
    const source = await db.get("SELECT * FROM DataSources WHERE id = ? AND deletedAt IS NULL", [sourceId]);
    if (!source) {
      return res.status(404).json({ success: false, error: 'Source not found' });
    }
    
    const { extractFeed } = await import('../etl/extractor.ts');
    // Try to extract feed with 1 retry
    const result = await extractFeed(source, 1);
    res.json({ success: true, message: `Successfully connected. Found ${result.items.length} items.` });
  } catch (error) {
    handleError(res, error, 'Connection test failed');
  }
});

// Get SyncRuns history
apiRouter.get('/sync-runs', async (req, res) => {
  try {
    const db = getDb();
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const countResult = await db.get('SELECT COUNT(*) as total FROM SyncRuns');
    const total = countResult.total;

    const runs = await db.all('SELECT * FROM SyncRuns ORDER BY timestamp DESC LIMIT ? OFFSET ?', limit, offset);
    res.json({ success: true, data: runs, total, page, limit });
  } catch (error) {
    handleError(res, error, 'Failed to fetch sync runs');
  }
});

// Get SourceMetrics
apiRouter.get('/source-metrics', async (req, res) => {
  try {
    const db = getDb();
    const metrics = await db.all('SELECT * FROM SourceMetrics ORDER BY sourceName ASC');
    res.json({ success: true, data: metrics });
  } catch (error) {
    handleError(res, error, 'Failed to fetch source metrics');
  }
});

// Get AppLogs
apiRouter.get('/logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const level = req.query.level as string;
    const search = req.query.search as string;
    const excludeLevel = req.query.excludeLevel as string;
    const syncRunId = req.query.syncRunId as string;
    
    const fuseDir = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'logs') : path.join(process.cwd(), 'data', 'logs');
    
    const getLogFiles = (dir: string) => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.startsWith('app-') && f.endsWith('.log')).map(f => path.join(dir, f)) : [];
    
    const allFiles = getLogFiles(fuseDir);
    
    // Sort files by modification time, newest first
    allFiles.sort((a, b) => {
      try {
        return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
      } catch (e) {
        return 0;
      }
    });

    let logs: any[] = [];
    
    for (const filePath of allFiles) {
      // Optimization: if we have enough logs for the current page, and we aren't doing a global search/filter that requires scanning everything
      if (!search && !syncRunId && logs.length >= page * limit + 100) {
         break; // Stop reading older files if we have enough for the current page + buffer
      }

      if (!fs.existsSync(filePath)) continue;

      const fileStream = fs.createReadStream(filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      const fileLogs = [];
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const appLog = {
            id: parsed.id || uuidv4(),
            timestamp: parsed.timestamp,
            level: parsed.severity || parsed.appLevel || parsed.level?.toUpperCase() || 'INFO',
            message: parsed.message,
            syncRunId: parsed.syncRunId,
            metadata: parsed.metadata || parsed.error
          };
          
          // Apply filters immediately to save memory
          if (syncRunId && appLog.syncRunId !== syncRunId) continue;
          if (level && level !== 'ALL' && appLog.level !== level) continue;
          if (excludeLevel && appLog.level === excludeLevel) continue;
          if (search) {
            const s = search.toLowerCase();
            const matches = (appLog.message && appLog.message.toLowerCase().includes(s)) || 
                            (appLog.metadata && typeof appLog.metadata === 'string' && appLog.metadata.toLowerCase().includes(s)) ||
                            (appLog.metadata && typeof appLog.metadata === 'object' && JSON.stringify(appLog.metadata).toLowerCase().includes(s)) ||
                            (appLog.syncRunId && appLog.syncRunId.toLowerCase().includes(s));
            if (!matches) continue;
          }
          
          fileLogs.push(appLog);
        } catch (e) {
          // ignore parse errors
        }
      }
      logs.push(...fileLogs.reverse());
    }

    const total = logs.length;
    const paginatedLogs = logs.slice((page - 1) * limit, page * limit);

    res.json({ success: true, data: paginatedLogs, total, page, limit });
  } catch (error) {
    handleError(res, error, 'Failed to fetch app logs');
  }
});

// Get system status
apiRouter.get('/system/status', async (req, res) => {
  try {
    const db = getDb();
    const dataDirBase = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    const dbPath = path.join(dataDirBase, 'gcp-datanator.db');
    
    let dbSize = 0;
    if (fs.existsSync(dbPath)) dbSize += fs.statSync(dbPath).size;
    if (fs.existsSync(dbPath + '-wal')) dbSize += fs.statSync(dbPath + '-wal').size;
    if (fs.existsSync(dbPath + '-shm')) dbSize += fs.statSync(dbPath + '-shm').size;
    
    const dataDir = path.join(dataDirBase, 'feeds');
    let totalFileSize = 0;
    let fileCount = 0;
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir);
      fileCount = files.length;
      for (const file of files) {
        totalFileSize += fs.statSync(path.join(dataDir, file)).size;
      }
    }

    res.json({
      success: true,
      data: {
        dbSize: dbSize,
        fileCount,
        totalFileSize,
        geminiKeySet: !!process.env.GEMINI_API_KEY,
        nodeVersion: process.version,
        platform: process.platform,
        uptime: process.uptime()
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to fetch system status');
  }
});

// Get system settings
apiRouter.get('/system/settings', async (req, res) => {
  try {
    const db = getDb();
    const settings = await db.all('SELECT * FROM Settings');
    const settingsMap = settings.reduce((acc: any, s: any) => {
      acc[s.key] = s.value;
      return acc;
    }, {});
    res.json({ success: true, data: settingsMap });
  } catch (error) {
    handleError(res, error, 'Failed to fetch settings');
  }
});

// Update system settings
apiRouter.post('/system/settings', validate(SettingUpdateSchema), async (req, res) => {
  const { key, value } = req.body;
  try {
    const db = getDb();
    await db.run('INSERT OR REPLACE INTO Settings (key, value, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)', key, String(value));
    res.json({ success: true, message: `Setting ${key} updated successfully` });
  } catch (error) {
    handleError(res, error, 'Failed to update settings');
  }
});

// Purge all data
apiRouter.post('/system/purge', async (req, res) => {
  try {
    const db = getDb();
    await db.exec('BEGIN TRANSACTION');
    try {
      await db.run('DELETE FROM SyncRuns');
      await db.run('DELETE FROM SourceMetrics');
      await db.exec('COMMIT');
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }

    // Delete files
    const dataDir = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'feeds');
    if (fs.existsSync(dataDir)) {
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch (fileError) {
        logger.error(`Failed to delete feeds directory during purge:`, { error: String(fileError) });
      }
    }
    // Recreate the directory
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Delete log files
    const logDir = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'logs') : path.join(process.cwd(), 'data', 'logs');
    if (fs.existsSync(logDir)) {
      try {
        const files = fs.readdirSync(logDir);
        for (const file of files) {
          // Don't delete the currently active log file if possible, or just ignore errors
          try {
            fs.unlinkSync(path.join(logDir, file));
          } catch (e) {
            // ignore
          }
        }
      } catch (logError) {
        logger.error(`Failed to delete log files during purge:`, { error: String(logError) });
      }
    }

    res.json({ success: true, message: 'System purged successfully' });
  } catch (error) {
    handleError(res, error, 'Failed to purge system');
  }
});

// Reset settings to defaults
apiRouter.post('/system/reset', async (req, res) => {
  try {
    const db = getDb();
    await db.exec('BEGIN TRANSACTION');
    try {
      await db.run('DELETE FROM Settings');
      const defaultSettings = [
        { key: 'logRetentionDays', value: '0' }
      ];
      for (const setting of defaultSettings) {
        await db.run('INSERT INTO Settings (key, value) VALUES (?, ?)', setting.key, setting.value);
      }
      await db.exec('COMMIT');
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
    res.json({ success: true, message: 'Settings reset to defaults' });
  } catch (error) {
    handleError(res, error, 'Failed to reset settings');
  }
});

// List output files
apiRouter.get('/files', async (req, res) => {
  try {
    const dataDir = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'feeds');
    if (!fs.existsSync(dataDir)) {
      return res.json({ success: true, data: [] });
    }
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.txt'));
    const fileStats = files.map(f => {
      const stats = fs.statSync(path.join(dataDir, f));
      return {
        name: f,
        size: stats.size,
        lastModified: stats.mtime
      };
    });
    
    // Sort files by last modified descending
    fileStats.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    
    res.json({ success: true, data: fileStats });
  } catch (error) {
    handleError(res, error, 'Failed to list files');
  }
});

// Download/View specific file
apiRouter.get('/files/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ success: false, error: 'Invalid filename' });
    }
    const filePath = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'feeds', filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }
    
    if (req.query.download === '1') {
      res.download(filePath);
    } else {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.sendFile(filePath);
    }
  } catch (error) {
    handleError(res, error, 'Failed to download file');
  }
});

// Download all files as ZIP
apiRouter.get('/files-download-all', async (req, res) => {
  try {
    const dataDir = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'feeds');
    if (!fs.existsSync(dataDir)) {
      return res.status(404).json({ success: false, error: 'No files to download' });
    }

    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.txt'));
    if (files.length === 0) {
      return res.status(404).json({ success: false, error: 'No files to download' });
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    const zipName = `gcp-datanator-export-${new Date().toISOString().split('T')[0]}.zip`;

    res.attachment(zipName);
    archive.pipe(res);

    for (const file of files) {
      archive.file(path.join(dataDir, file), { name: file });
    }

    await archive.finalize();
  } catch (error) {
    handleError(res, error, 'Failed to generate ZIP');
  }
});

// Export files to GCS
apiRouter.post('/files-export-gcs', validate(GCSExportSchema), async (req, res) => {
  const { projectId, bucketName, authCode, accessToken } = req.body;
  
  try {
    const dataDir = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'feeds');
    if (!fs.existsSync(dataDir)) {
      return res.status(404).json({ success: false, error: 'No files to export' });
    }

    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.txt'));
    if (files.length === 0) {
      return res.status(404).json({ success: false, error: 'No files to export' });
    }

    let finalToken = accessToken;

    // If authCode is provided, exchange it for a token
    if (authCode && !accessToken) {
      const oauth2Client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        'postmessage' // Standard for popup-based OAuth
      );
      const { tokens } = await oauth2Client.getToken(authCode);
      finalToken = tokens.access_token;
    }

    if (!finalToken) {
      return res.status(400).json({ success: false, error: 'Failed to obtain access token' });
    }

    const oauth2Client = new OAuth2Client();
    oauth2Client.setCredentials({ access_token: finalToken });

    const storage = new Storage({
      projectId,
      authClient: oauth2Client as any
    });

    const bucket = storage.bucket(bucketName);
    
    // Check if bucket exists
    const [exists] = await bucket.exists();
    if (!exists) {
      return res.status(404).json({ success: false, error: `Bucket ${bucketName} does not exist in project ${projectId}` });
    }

    const uploadPromises = files.map(file => {
      return bucket.upload(path.join(dataDir, file), {
        destination: `gcp-datanator-export/${new Date().toISOString().split('T')[0]}/${file}`,
        resumable: false
      });
    });

    const results = await Promise.allSettled(uploadPromises);
    const failed = results.filter(r => r.status === 'rejected');
    
    if (failed.length > 0) {
      logger.error(`GCS Export: ${failed.length} files failed to upload.`, { failed });
      if (failed.length === files.length) {
        return res.status(500).json({ success: false, error: 'All file uploads failed. Check server logs.' });
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
    handleError(res, error, 'GCS Export failed');
  }
});
