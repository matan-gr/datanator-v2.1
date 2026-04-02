import { z } from 'zod';

export const SettingUpdateSchema = z.object({
  key: z.string().min(1, 'Key is required'),
  value: z.string().min(1, 'Value is required'),
});

export const DataSourceSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  url: z.string().url('Must be a valid URL'),
  type: z.enum(['rss', 'atom', 'json']),
  isActive: z.boolean().optional(),
  config: z.any().optional()
});

export const GCSExportSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  bucketName: z.string().min(1, 'Bucket name is required'),
  authCode: z.string().optional(),
  accessToken: z.string().optional(),
}).refine(data => data.authCode || data.accessToken, {
  message: "Either authCode or accessToken must be provided",
  path: ["authCode"]
});
