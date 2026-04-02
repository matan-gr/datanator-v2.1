import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { initDb, getDb, closeDb } from './src/server/db/sqlite.ts';
import { syncConfiguration } from './src/server/config/sync.ts';
import { apiRouter } from './src/server/api/routes.ts';
import { flushActiveIndexes } from './src/server/etl/pipeline.ts';
import { flushLogs } from './src/server/utils/logger.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

async function startServer() {
  try {
    const app = express();
    const PORT = 3000;

    app.use(cors());
    app.use(express.json());

    // Network logging middleware
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        // Skip spammy polling endpoints and static assets from cluttering Cloud Logging
        const isPolling = req.originalUrl.includes('/api/v1/sync-runs') || req.originalUrl.includes('/api/v1/metrics') || req.originalUrl.includes('/api/v1/logs');
        const isStaticAsset = req.originalUrl.startsWith('/src/') || 
                              req.originalUrl.startsWith('/@') || 
                              req.originalUrl.startsWith('/node_modules/') || 
                              req.originalUrl.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|tsx|ts|woff|woff2)$/);
        
        if (isPolling || isStaticAsset) {
          return;
        }
        console.log(`NETWORK: ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
      });
      next();
    });

    // Initialize SQLite
    await initDb();
    
    // Sync configuration from YAML
    await syncConfiguration();

    // API Routes
    app.use('/api/v1', apiRouter);

    // 404 handler for API routes
    app.use('/api/v1', (req, res) => {
      console.log('HIT 404 handler:', req.method, req.originalUrl);
      res.status(404).json({ success: false, error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
    });

    // Global API error handler
    app.use('/api/v1', (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('API Error:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Internal Server Error',
        stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined
      });
    });

    // Vite middleware for development
    if (process.env.NODE_ENV !== 'production') {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      // In production, the server is running from the root directory
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });

    const gracefulShutdown = async () => {
      console.log('Received kill signal, shutting down gracefully');
      await flushActiveIndexes();
      await flushLogs();
      server.close(async () => {
        console.log('Closed out remaining connections');
        await closeDb();
        process.exit(0);
      });
      setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 5000);
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

    server.on('error', (error: any) => {
      console.error('Server error:', error);
      if (error.code === 'EADDRINUSE') {
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
