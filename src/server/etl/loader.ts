import fs from 'fs';
import path from 'path';
import type { DataSource } from './extractor.ts';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export class IndexManager {
  private indexPath: string;
  private seenIds: Set<string>;
  private newIds: string[];

  constructor(source: DataSource, baseDataDir: string) {
    const dataDir = path.join(baseDataDir, 'feeds');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const safeSourceName = source.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    this.indexPath = path.join(dataDir, `${safeSourceName}.index`);
    this.seenIds = new Set();
    this.newIds = [];
  }

  public loadIndex() {
    if (fs.existsSync(this.indexPath)) {
      const content = fs.readFileSync(this.indexPath, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          this.seenIds.add(line.trim());
        }
      }
    }
  }

  public isDuplicate(id: string): boolean {
    return this.seenIds.has(id);
  }

  public markSeen(id: string) {
    this.seenIds.add(id);
    this.newIds.push(id);
  }

  public flush() {
    if (this.newIds.length > 0) {
      const content = this.newIds.join('\n') + '\n';
      fs.appendFileSync(this.indexPath, content, 'utf8');
      this.newIds = [];
    }
  }
}

export class ChunkedWriter {
  private dataDir: string;
  private safeSourceName: string;
  private currentPart: number = 1;
  private currentStream: fs.WriteStream | null = null;
  private currentBytes: number = 0;
  private timestamp: string = '';
  private currentFileName: string = '';

  constructor(source: DataSource, baseDataDir: string) {
    this.dataDir = path.join(baseDataDir, 'feeds');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.safeSourceName = source.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    this.initialize(source);
  }

  private initialize(source: DataSource) {
    if (source.currentFileName) {
      // Parse the existing filename: source_timestamp_partNNN.txt
      const match = source.currentFileName.match(/_(\d+)_part(\d+)\.txt$/);
      if (match) {
        this.timestamp = match[1];
        this.currentPart = parseInt(match[2], 10);
        this.currentFileName = source.currentFileName;
        
        // Self-healing: check actual file size
        const filePath = path.join(this.dataDir, this.currentFileName);
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          this.currentBytes = stats.size;
        } else {
          // File missing, start fresh
          this.timestamp = Date.now().toString().padStart(13, '0');
          this.currentPart = 1;
          this.currentBytes = 0;
          this.currentFileName = `${this.safeSourceName}_${this.timestamp}_part001.txt`;
        }
      } else {
        // Invalid format, start fresh
        this.timestamp = Date.now().toString().padStart(13, '0');
        this.currentPart = 1;
        this.currentBytes = 0;
        this.currentFileName = `${this.safeSourceName}_${this.timestamp}_part001.txt`;
      }
    } else {
      // First run
      this.timestamp = Date.now().toString().padStart(13, '0');
      this.currentPart = 1;
      this.currentBytes = 0;
      this.currentFileName = `${this.safeSourceName}_${this.timestamp}_part001.txt`;
    }

    if (this.currentBytes >= MAX_FILE_SIZE) {
      this.rotate();
    } else {
      this.openStream();
    }
  }

  private openStream() {
    const filePath = path.join(this.dataDir, this.currentFileName);
    this.currentStream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
  }

  public write(line: string) {
    const lineWithNewline = line + '\n';
    const bytes = Buffer.byteLength(lineWithNewline, 'utf8');

    if (this.currentBytes + bytes > MAX_FILE_SIZE) {
      this.rotate();
    }

    if (this.currentStream) {
      this.currentStream.write(lineWithNewline);
      this.currentBytes += bytes;
    }
  }

  private rotate() {
    if (this.currentStream) {
      this.currentStream.end();
    }
    this.currentPart++;
    this.currentBytes = 0;
    const paddedPart = this.currentPart.toString().padStart(3, '0');
    this.currentFileName = `${this.safeSourceName}_${this.timestamp}_part${paddedPart}.txt`;
    this.openStream();
  }

  public close() {
    if (this.currentStream) {
      this.currentStream.end();
      this.currentStream = null;
    }
  }

  public getState() {
    return {
      currentFileName: this.currentFileName,
      currentFileBytes: this.currentBytes
    };
  }
}
