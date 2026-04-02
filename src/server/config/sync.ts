import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import yaml from 'yaml';
import { getDb } from '../db/sqlite.ts';
import { logger } from '../utils/logger.ts';

const DEFAULT_SOURCES = [
  { id: 'cloud-blog-main', name: 'Cloud Blog - Main', url: 'https://cloudblog.withgoogle.com/rss/', type: 'rss' },
  { id: 'medium-blog', name: 'Medium Blog', url: 'https://medium.com/feed/google-cloud', type: 'rss' },
  { id: 'cloud-innovation', name: 'Google Cloud Innovation', url: 'https://blog.google/innovation-and-ai/infrastructure-and-cloud/google-cloud/rss/', type: 'rss' },
  { id: 'ai-technology', name: 'Google AI Technology', url: 'https://blog.google/innovation-and-ai/technology/ai/rss/', type: 'rss' },
  { id: 'release-notes', name: 'Release Notes & Deprecations', url: 'https://cloud.google.com/feeds/gcp-release-notes.xml', type: 'rss' },
  { id: 'ai-research', name: 'Google AI Research', url: 'http://googleaiblog.blogspot.com/atom.xml?max-results=1000', type: 'atom' },
  { id: 'gemini-workspace', name: 'Gemini & Workspace', url: 'https://workspaceupdates.googleblog.com/feeds/posts/default?max-results=1000', type: 'atom' },
  { id: 'service-health', name: 'Service Health (Incidents)', url: 'https://status.cloud.google.com/feed.atom', type: 'atom' },
  { id: 'security-bulletins', name: 'Security Bulletins', url: 'https://cloud.google.com/feeds/google-cloud-security-bulletins.xml', type: 'rss' },
  { id: 'terraform-provider', name: 'Terraform Provider (IaC Releases)', url: 'https://github.com/hashicorp/terraform-provider-google/releases.atom', type: 'atom' }
];

export async function syncConfiguration() {
  const db = getDb();
  const configPath = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'datanator-config.yaml');
  
  let systemSources: any[] = [];
  let yamlHash = '';

  if (fs.existsSync(configPath)) {
    try {
      const fileContent = fs.readFileSync(configPath, 'utf8');
      yamlHash = crypto.createHash('sha256').update(fileContent).digest('hex');
      const parsed = yaml.parse(fileContent);
      if (parsed && Array.isArray(parsed.sources)) {
        systemSources = parsed.sources;
      }
    } catch (err) {
      logger.error('Failed to parse datanator-config.yaml:', { error: String(err) });
    }
  } else {
    // If no config file exists, we seed with the defaults as SYSTEM sources
    // We can also create the file to make it explicit
    try {
      const defaultYaml = yaml.stringify({ sources: DEFAULT_SOURCES });
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, defaultYaml, 'utf8');
      yamlHash = crypto.createHash('sha256').update(defaultYaml).digest('hex');
      systemSources = DEFAULT_SOURCES;
      logger.info('Created default datanator-config.yaml');
    } catch (err) {
      logger.error('Failed to create default config:', { error: String(err) });
      // Fallback to in-memory defaults
      systemSources = DEFAULT_SOURCES;
      yamlHash = 'default-fallback';
    }
  }

  await db.exec('BEGIN TRANSACTION');
  try {
    const existingSystemSources = await db.all("SELECT id, yamlHash FROM DataSources WHERE origin = 'SYSTEM' AND deletedAt IS NULL");
    const existingIds = new Set(existingSystemSources.map(s => s.id));
    const newIds = new Set(systemSources.map(s => s.id));

    // Upsert SYSTEM sources
    for (const source of systemSources) {
      const existing = existingSystemSources.find(s => s.id === source.id);
      const configStr = source.config ? JSON.stringify(source.config) : null;
      
      if (!existing) {
        // Insert new
        await db.run(
          `INSERT INTO DataSources (id, name, url, type, origin, isActive, config, yamlHash)
           VALUES (?, ?, ?, ?, 'SYSTEM', 1, ?, ?)`,
          [source.id, source.name, source.url, source.type, configStr, yamlHash]
        );
        await db.run(
          `INSERT INTO ConfigAuditLogs (entityType, entityId, action, changes, user) VALUES (?, ?, ?, ?, ?)`,
          ['DataSource', source.id, 'CREATE', JSON.stringify({ name: source.name, url: source.url, type: source.type, config: source.config }), 'SYSTEM']
        );
      } else if (existing.yamlHash !== yamlHash) {
        // Update existing if hash changed
        await db.run(
          `UPDATE DataSources 
           SET name = ?, url = ?, type = ?, config = ?, yamlHash = ?, updatedAt = CURRENT_TIMESTAMP
           WHERE id = ? AND origin = 'SYSTEM'`,
          [source.name, source.url, source.type, configStr, yamlHash, source.id]
        );
        await db.run(
          `INSERT INTO ConfigAuditLogs (entityType, entityId, action, changes, user) VALUES (?, ?, ?, ?, ?)`,
          ['DataSource', source.id, 'UPDATE', JSON.stringify({ name: source.name, url: source.url, type: source.type, config: source.config }), 'SYSTEM']
        );
      }
    }

    // Soft-delete missing SYSTEM sources
    for (const id of existingIds) {
      if (!newIds.has(id)) {
        await db.run(
          `UPDATE DataSources SET deletedAt = CURRENT_TIMESTAMP, isActive = 0 WHERE id = ? AND origin = 'SYSTEM'`,
          [id]
        );
        await db.run(
          `INSERT INTO ConfigAuditLogs (entityType, entityId, action, user) VALUES (?, ?, ?, ?)`,
          ['DataSource', id, 'DELETE', 'SYSTEM']
        );
      }
    }

    await db.exec('COMMIT');
    logger.info('Configuration sync complete. System sources updated.');
  } catch (err) {
    await db.exec('ROLLBACK');
    logger.error('Failed to sync configuration to database:', { error: String(err) });
  }
}
