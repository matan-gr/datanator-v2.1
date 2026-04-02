import Parser from 'rss-parser';
import crypto from 'crypto';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

const NON_RETRIABLE_STATUSES = new Set([400, 401, 403, 404, 405, 406, 410, 422]);

function getRetryAfterMs(response: Response, defaultDelayMs: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) return defaultDelayMs;

  if (!isNaN(Number(retryAfter))) {
    return parseInt(retryAfter, 10) * 1000;
  }

  const date = new Date(retryAfter).getTime();
  if (!isNaN(date)) {
    const delay = date - Date.now();
    return delay > 0 ? delay : defaultDelayMs;
  }

  return defaultDelayMs;
}

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function createParser() {
  return new Parser({
    timeout: 60000, // 60 seconds to handle larger feeds
    customFields: {
      item: ['content:encoded', 'description', 'pubDate', 'updated', 'published']
    },
    headers: {
      'User-Agent': `${getRandomUserAgent()} GCP Datanator/0.9`,
      'Accept': 'application/rss+xml, application/rdf+xml, application/atom+xml, application/xml, text/xml, text/html, */*'
    }
  });
}

export interface RawFeedItem {
  title?: string;
  link?: string;
  pubDate?: string;
  content?: string;
  contentSnippet?: string;
  guid?: string;
  id?: string;
}

export interface DataSource {
  id: string;
  name: string;
  url: string;
  type: 'rss' | 'atom' | 'json';
  origin?: 'SYSTEM' | 'USER';
  isActive?: boolean;
  config?: any;
  consecutiveFailures?: number;
  circuitOpen?: boolean;
  etag?: string;
  lastModified?: string;
  lastContentHash?: string;
  currentFileName?: string;
  currentFileBytes?: number;
}

export interface ExtractResult {
  items: RawFeedItem[];
  status: number;
  statusText: string;
  url: string;
  duration: number;
  isUnchanged?: boolean;
  etag?: string;
  lastModified?: string;
  hash?: string;
}

export async function extractFeed(source: DataSource, retries = 3): Promise<ExtractResult> {
  // Add random jitter (0-2000ms) to prevent thundering herd and rate limits
  const jitter = Math.floor(Math.random() * 2000);
  await new Promise(resolve => setTimeout(resolve, jitter));

  let lastError: Error | null = null;
  let lastStatus = 0;
  let lastStatusText = '';
  let duration = 0;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.debug(`Starting extraction for source: ${source.name} (${source.url}) - Attempt ${attempt}/${retries}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);
      
      const headers: Record<string, string> = {
        'User-Agent': `${getRandomUserAgent()} GCP Datanator/0.9`,
        'Accept': 'application/rss+xml, application/rdf+xml, application/atom+xml, application/xml, text/xml, text/html, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br'
      };

      if (source.etag) headers['If-None-Match'] = source.etag;
      if (source.lastModified) headers['If-Modified-Since'] = source.lastModified;

      const startTime = Date.now();
      const response = await fetch(source.url, {
        headers,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      duration = Date.now() - startTime;
      
      lastStatus = response.status;
      lastStatusText = response.statusText;

      if (response.status === 304) {
        console.debug(`Source ${source.name} returned 304 Not Modified. Skipping parsing.`);
        return {
          items: [],
          status: 304,
          statusText: 'Not Modified',
          url: response.url,
          duration,
          isUnchanged: true
        };
      }

      if (!response.ok) {
        if (NON_RETRIABLE_STATUSES.has(response.status)) {
          const err = new Error(`HTTP Error: ${response.status} ${response.statusText}`);
          (err as any).isTerminal = true;
          throw err;
        }
        
        const baseDelay = Math.pow(2, attempt) * 1000;
        const retryAfterDelay = getRetryAfterMs(response as any, baseDelay);
        const finalDelay = retryAfterDelay + Math.floor(Math.random() * 1000);
        
        const err = new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        (err as any).retryDelay = finalDelay;
        throw err;
      }

      const text = await response.text();
      const newEtag = response.headers.get('etag') || undefined;
      const newLastModified = response.headers.get('last-modified') || undefined;

      // Canonicalization: remove volatile tags before hashing
      const canonicalText = text
        .replace(/<lastBuildDate>.*?<\/lastBuildDate>/g, '')
        .replace(/<pubDate>.*?<\/pubDate>/g, '')
        .replace(/<generator>.*?<\/generator>/g, '');
      
      const hash = crypto.createHash('sha256').update(canonicalText).digest('hex');

      if (source.lastContentHash === hash) {
        console.debug(`Source ${source.name} content hash matched. Skipping parsing.`);
        return {
          items: [],
          status: response.status,
          statusText: response.statusText,
          url: response.url,
          duration,
          isUnchanged: true,
          etag: newEtag,
          lastModified: newLastModified,
          hash
        };
      }

      const parser = createParser();
      const feed = await parser.parseString(text);
      
      console.debug(`Fetched ${feed.items.length} total items from ${source.name}.`);

      const items = feed.items
        .filter(item => item.title || item.content || item.description || item['content:encoded'])
        .map(item => {
        // Generate a deterministic GUID if one is not provided by the feed
        // We use link primarily, fallback to title, to avoid duplicates if pubDate changes
        const uniqueString = item.link ? item.link : (item.title || '');
        const deterministicGuid = crypto.createHash('sha256')
          .update(uniqueString)
          .digest('hex');
          
        return {
          title: item.title,
          link: item.link,
          pubDate: item.pubDate || item.updated || item.published,
          content: item['content:encoded'] || item.content || item.description,
          contentSnippet: item.contentSnippet,
          guid: item.guid || (item as any).id || deterministicGuid
        };
      });

      return {
        items,
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        duration,
        isUnchanged: false,
        etag: newEtag,
        lastModified: newLastModified,
        hash
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`Attempt ${attempt} failed to extract feed ${source.name}:`, error);
      
      if ((lastError as any).isTerminal) {
        console.error(`Terminal error encountered for ${source.name}. Aborting retries.`);
        throw new Error(`Terminal error extracting feed ${source.name}: HTTP ${lastStatus} ${lastStatusText} - ${lastError.message}`);
      }
      
      if (attempt === retries) {
        throw new Error(`Failed to extract feed ${source.name} after ${retries} attempts: HTTP ${lastStatus} ${lastStatusText} - ${lastError.message}`);
      }
      
      // Wait before retrying
      const delay = (lastError as any).retryDelay || (Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 1000));
      console.debug(`Waiting ${delay}ms before next attempt for ${source.name}...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return { items: [], status: lastStatus, statusText: lastStatusText, url: source.url, duration };
}
