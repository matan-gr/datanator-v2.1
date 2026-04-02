import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/sqlite.ts';
import { extractFeed } from './extractor.ts';
import type { DataSource } from './extractor.ts';
import { transformItems, formatItem } from './transformer.ts';
import { IndexManager, ChunkedWriter } from './loader.ts';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.ts';

const activeIndexManagers = new Set<IndexManager>();

export async function flushActiveIndexes() {
  for (const manager of activeIndexManagers) {
    try {
      manager.flush();
    } catch (e) {
      console.error('Failed to flush index manager on shutdown:', e);
    }
  }
}

async function logAppEvent(db: any, level: 'INFO' | 'WARN' | 'ERROR' | 'NETWORK', message: string, syncRunId: string, metadata?: string) {
  const logData = {
    id: uuidv4(),
    appLevel: level,
    syncRunId,
    metadata
  };

  if (level === 'ERROR') {
    logger.error(message, logData);
  } else if (level === 'WARN') {
    logger.warn(message, logData);
  } else {
    logger.info(message, logData);
  }
}

export async function runSync(triggerType: 'SCHEDULED' | 'MANUAL', sourceId?: string, force: boolean = false, wait: boolean = false): Promise<string> {
  const db = getDb();
  
  // Self-heal: Mark any RUNNING jobs older than 30 minutes as FAILED
  await db.run(`
    UPDATE SyncRuns 
    SET status = 'FAILED', errorSummary = 'Killed due to server restart or timeout' 
    WHERE status = 'RUNNING' AND timestamp < datetime('now', '-30 minutes')
  `);
  
  // Check if a sync is already running
  const existingRunning = await db.get("SELECT id FROM SyncRuns WHERE status = 'RUNNING' LIMIT 1");
  if (existingRunning && !force) {
    logger.warn(`Sync already running with ID: ${existingRunning.id}. Skipping.`);
    return existingRunning.id;
  }

  const runId = uuidv4();
  
  // Initialize SyncRun
  await db.run(
    'INSERT INTO SyncRuns (id, status, triggerType) VALUES (?, ?, ?)',
    [runId, 'RUNNING', triggerType]
  );
  
  // Start the background process
  const syncProcess = async () => {
    try {
      let sourcesToSync: DataSource[] = [];
      if (sourceId) {
        sourcesToSync = await db.all("SELECT * FROM DataSources WHERE id = ? AND deletedAt IS NULL", [sourceId]);
      } else {
        sourcesToSync = await db.all("SELECT * FROM DataSources WHERE isActive = 1 AND circuitOpen = 0 AND deletedAt IS NULL");
      }
        
      const results = [];
      for (const source of sourcesToSync) {
        try {
          const baseDataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
          
          // Self-healing: If DB thinks we have a file, but it's missing from disk, force a full re-fetch
          if (source.currentFileName) {
            const filePath = path.join(baseDataDir, 'feeds', source.currentFileName);
            if (!fs.existsSync(filePath)) {
              await logAppEvent(db, 'WARN', `File ${source.currentFileName} missing from disk. Forcing full re-fetch for ${source.name}.`, runId);
              source.etag = undefined;
              source.lastModified = undefined;
              source.lastContentHash = undefined;
              source.currentFileName = undefined;
              source.currentFileBytes = 0;
              
              const safeSourceName = source.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
              const indexPath = path.join(baseDataDir, 'feeds', `${safeSourceName}.index`);
              if (fs.existsSync(indexPath)) {
                 fs.renameSync(indexPath, `${indexPath}.archived_${Date.now()}`);
              }
            }
          }

          // 1. Extract
          const { items: rawItems, status, statusText, url, duration, isUnchanged, etag, lastModified, hash } = await extractFeed(source);
          
          // Log HTTP response details
          await logAppEvent(
            db,
            'NETWORK',
            `Source ${source.name}: HTTP ${status} ${statusText} from ${url}`,
            runId,
            JSON.stringify({ status, statusText, url, method: 'GET', duration, isUnchanged })
          );

          if (isUnchanged) {
            await logAppEvent(
              db,
              'INFO',
              `Source ${source.name}: No changes detected (ETag/Hash match). Skipping parsing.`,
              runId
            );

            // Update DataSources with new etag/lastModified/hash if provided
            await db.run(`
              UPDATE DataSources 
              SET etag = COALESCE(?, etag), 
                  lastModified = COALESCE(?, lastModified), 
                  lastContentHash = COALESCE(?, lastContentHash),
                  consecutiveFailures = 0
              WHERE id = ?
            `, [etag || null, lastModified || null, hash || null, source.id]);

            // Update SourceMetrics
            await db.run(`
              INSERT INTO SourceMetrics (id, sourceName, sourceUrl, lastSyncTimestamp, itemsParsedLastSync, healthStatus, lastTriggerType)
              VALUES (?, ?, ?, CURRENT_TIMESTAMP, 0, 'HEALTHY', ?)
              ON CONFLICT(id) DO UPDATE SET
                lastSyncTimestamp = CURRENT_TIMESTAMP,
                itemsParsedLastSync = 0,
                healthStatus = 'HEALTHY',
                lastErrorMessage = NULL,
                lastTriggerType = excluded.lastTriggerType
            `, [source.id, source.name, source.url, triggerType]);

            results.push({ success: true, items: 0, files: 0, unchanged: true });
            continue;
          }

          // 1.5 Deduplicate against previously parsed items
          const indexManager = new IndexManager(source, baseDataDir);
          activeIndexManagers.add(indexManager);
          indexManager.loadIndex();
          
          const newRawItems = rawItems.filter(item => {
            if (!item.guid) return false;
            return !indexManager.isDuplicate(item.guid);
          });
          
          // Log exact deduplication metrics
          const totalFetched = rawItems.length;
          const duplicates = totalFetched - newRawItems.length;
          
          if (duplicates > 0) {
            await logAppEvent(
              db,
              'INFO',
              `Skipped ${duplicates} already parsed items for source: ${source.name}`,
              runId
            );
          }

          await logAppEvent(
            db,
            'INFO',
            `Source ${source.name}: Fetched ${totalFetched} items. Processing ${newRawItems.length} new items.`,
            runId
          );
          
          // 2. Transform
          const transformedItems = transformItems(newRawItems, source);
          const itemsCount = transformedItems.length;
          let filesCount = 0;
          let writerState = { currentFileName: source.currentFileName, currentFileBytes: source.currentFileBytes };
          
          // 3. Load
          if (itemsCount > 0) {
            try {
              const writer = new ChunkedWriter(source, baseDataDir);
              for (const item of transformedItems) {
                writer.write(formatItem(item));
                indexManager.markSeen(item.guid);
              }
              writer.close();
              writerState = writer.getState();
              indexManager.flush();
              activeIndexManagers.delete(indexManager);
              filesCount = 1; // File was successfully created locally
            } catch (fileError) {
              activeIndexManagers.delete(indexManager);
              throw new Error(`File save failed: ${fileError instanceof Error ? fileError.message : String(fileError)}`);
            }
          } else {
            // Even if 0 items, let's touch the file to show it was checked
            try {
              const writer = new ChunkedWriter(source, baseDataDir);
              writer.close();
              writerState = writer.getState();
              indexManager.flush();
              activeIndexManagers.delete(indexManager);
              filesCount = 1;
            } catch (fileError) {
              activeIndexManagers.delete(indexManager);
              await logAppEvent(
                db,
                'WARN',
                `Failed to touch file for ${source.name}`,
                runId,
                JSON.stringify({ error: String(fileError) })
              );
              // Non-fatal, continue
            }
          }
          
          // Update DataSources with new state
          await db.run(`
            UPDATE DataSources 
            SET etag = ?, 
                lastModified = ?, 
                lastContentHash = ?,
                currentFileName = ?,
                currentFileBytes = ?,
                consecutiveFailures = 0
            WHERE id = ?
          `, [
            etag || null, 
            lastModified || null, 
            hash || null, 
            writerState.currentFileName || null, 
            writerState.currentFileBytes || 0, 
            source.id
          ]);

          // Update SourceMetrics
          await db.run(`
            INSERT INTO SourceMetrics (id, sourceName, sourceUrl, lastSyncTimestamp, itemsParsedLastSync, healthStatus, lastTriggerType)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, 'HEALTHY', ?)
            ON CONFLICT(id) DO UPDATE SET
              lastSyncTimestamp = CURRENT_TIMESTAMP,
              itemsParsedLastSync = excluded.itemsParsedLastSync,
              healthStatus = 'HEALTHY',
              lastErrorMessage = NULL,
              lastTriggerType = excluded.lastTriggerType
          `, [source.id, source.name, source.url, itemsCount, triggerType]);
          
          // Log Success
          await logAppEvent(
            db,
            'INFO',
            `Successfully synced ${source.name} (${itemsCount} items)`,
            runId
          );
          
          results.push({ success: true, items: itemsCount, files: filesCount });
        } catch (error) {
          // Update SourceMetrics for failure
          await db.run(`
            INSERT INTO SourceMetrics (id, sourceName, sourceUrl, lastSyncTimestamp, healthStatus, lastErrorMessage, lastTriggerType)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, 'FAILING', ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              lastSyncTimestamp = CURRENT_TIMESTAMP,
              healthStatus = 'FAILING',
              lastErrorMessage = excluded.lastErrorMessage,
              lastTriggerType = excluded.lastTriggerType
          `, [source.id, source.name, source.url, String(error), triggerType]);
          
          // Circuit Breaker logic
          await db.run(`UPDATE DataSources SET consecutiveFailures = consecutiveFailures + 1 WHERE id = ?`, [source.id]);
          const updatedSource = await db.get(`SELECT consecutiveFailures FROM DataSources WHERE id = ?`, [source.id]);
          if (updatedSource && updatedSource.consecutiveFailures >= 5) {
            await db.run(`UPDATE DataSources SET circuitOpen = 1 WHERE id = ?`, [source.id]);
            await logAppEvent(
              db,
              'ERROR',
              `Circuit breaker tripped for ${source.name} after 5 consecutive failures.`,
              runId
            );
          }
          
          // Log Error
          const errorStack = error instanceof Error ? error.stack : undefined;
          await logAppEvent(
            db,
            'ERROR',
            `Failed to sync ${source.name}`,
            runId,
            JSON.stringify({ error: String(error), stack: errorStack })
          );
          
          results.push({ success: false, items: 0, files: 0, error: `${source.name}: ${String(error)}` });
        }
      }

      const totalItems = results.reduce((sum, r) => sum + r.items, 0);
      const totalFiles = results.reduce((sum, r) => sum + r.files, 0);
      const errors = results.filter(r => !r.success).map(r => r.error as string);
      
      // Finalize SyncRun
      const finalStatus = errors.length === 0 ? 'SUCCESS' : (errors.length < sourcesToSync.length ? 'PARTIAL_SUCCESS' : 'FAILED');
      const errorSummary = errors.length > 0 ? errors.join(' | ') : null;
      
      await db.run(
        'UPDATE SyncRuns SET status = ?, totalFilesGenerated = ?, totalItemsParsed = ?, errorSummary = ? WHERE id = ?',
        [finalStatus, totalFiles, totalItems, errorSummary, runId]
      );

      // 4. Cleanup old data based on retention policy
      try {
        const retentionSetting = await db.get("SELECT value FROM Settings WHERE key = 'logRetentionDays'");
        const retentionDays = parseInt(retentionSetting?.value || '30');
        
        if (retentionDays > 0) {
          const cleanupDate = new Date();
          cleanupDate.setDate(cleanupDate.getDate() - retentionDays);
          // SQLite format: YYYY-MM-DD HH:MM:SS
          const cleanupDateStr = cleanupDate.toISOString().replace('T', ' ').substring(0, 19);
          
          await db.run("DELETE FROM SyncRuns WHERE timestamp < ? AND status != 'RUNNING'", cleanupDateStr);
          
          // Reclaim space and optimize database
          await db.exec('PRAGMA incremental_vacuum');
          await db.exec('PRAGMA optimize');
          
          await logAppEvent(
            db,
            'INFO',
            `Cleanup completed. Removed DB records older than ${retentionDays} days. Vacuumed and optimized DB.`,
            runId
          );
          logger.info(`Cleanup completed. Removed data older than ${retentionDays} days (${cleanupDateStr}).`);
        }
      } catch (cleanupError) {
        await logAppEvent(
          db,
          'ERROR',
          'Failed to perform automatic cleanup',
          runId,
          JSON.stringify({ error: String(cleanupError) })
        );
      }
    } catch (fatalError) {
      await db.run(
        'UPDATE SyncRuns SET status = ?, errorSummary = ? WHERE id = ?',
        ['FAILED', `Fatal error: ${fatalError instanceof Error ? fatalError.message : String(fatalError)}`, runId]
      );
      await logAppEvent(
        db,
        'ERROR',
        `Fatal pipeline error`,
        runId,
        JSON.stringify({ error: String(fatalError) })
      );
    }
  };

  // Execute background process
  if (wait) {
    await syncProcess();
  } else {
    syncProcess().catch(err => {
      logger.error(`Fatal error in background sync process ${runId}:`, { error: String(err) });
    });
  }
  
  return runId;
}
