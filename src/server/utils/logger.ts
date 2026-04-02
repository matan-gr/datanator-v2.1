import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const startupId = uuidv4().substring(0, 8);
const fuseDir = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'logs') : path.join(process.cwd(), 'data', 'logs');

if (!fs.existsSync(fuseDir)) fs.mkdirSync(fuseDir, { recursive: true });

const fileTransport = new DailyRotateFile({
  dirname: fuseDir,
  filename: `app-%DATE%-${startupId}.log`,
  datePattern: 'YYYY-MM-DD',
  zippedArchive: false,
  maxSize: '5m',
  maxFiles: '14d'
});

// Map Winston levels to GCP severity
const gcpFormat = winston.format((info) => {
  info.severity = info.level.toUpperCase();
  return info;
});

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    gcpFormat(),
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        gcpFormat(),
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    fileTransport
  ]
});

export const flushLogs = async () => {
  // No-op since we write directly to FUSE now
};
