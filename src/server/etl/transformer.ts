import { parseISO } from 'date-fns';
import { convert } from 'html-to-text';
import type { RawFeedItem, DataSource } from './extractor.ts';

export interface TransformedItem {
  title: string;
  date: string;
  url: string;
  body: string;
  guid: string;
}

export function transformItems(items: RawFeedItem[], source: DataSource): TransformedItem[] {
  const seenGuids = new Set<string>();
  const transformed: TransformedItem[] = [];

  for (const item of items) {
    // 1. Deduplication (within this batch)
    if (!item.guid || seenGuids.has(item.guid)) continue;
    seenGuids.add(item.guid);

    let pubDate = new Date();
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

    // 2. Aggressive Sanitization into clean text
    const rawContent = item.content || item.contentSnippet || '';
    const cleanBody = convert(rawContent, {
      wordwrap: 130,
      selectors: [
        { selector: 'a', options: { ignoreHref: true } },
        { selector: 'img', format: 'skip' }
      ]
    }).replace(/\n{3,}/g, '\n\n').trim();

    transformed.push({
      title: item.title?.trim() || 'Untitled',
      date: pubDate.toISOString(),
      url: item.link || '',
      body: cleanBody,
      guid: item.guid
    });
  }

  return transformed;
}

export function formatItem(item: TransformedItem): string {
  return `---
Title: ${item.title}
Date: ${item.date}
URL: ${item.url}
GUID: ${item.guid}

${item.body}
`;
}
