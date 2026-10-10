import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cookieParser from 'cookie-parser';
import { setupDatabase, db, databaseCorrupted, databaseErrorMessage, checkpointAndCloseDatabase, sqlite } from './server/db/index.js';
import { users } from './server/db/schema.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupWebSockets } from './server/ws/index.js';
import { requireAuth } from './server/middleware/auth.js';

// Convert import.meta.url for path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws/karaoke' });
setupWebSockets(wss);

const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Production configuration and secrets verification
const JWT_SECRET = process.env.JWT_SECRET;
if (isProd && (!JWT_SECRET || JWT_SECRET === 'fallback_secret_for_dev' || JWT_SECRET === 'change_this_to_a_long_random_secret_in_production')) {
  console.error('🚨 CRITICAL CONFIGURATION ERROR: A secure JWT_SECRET environment variable must be specified in production mode.');
  process.exit(1);
}

import { createRateLimiter } from './server/middleware/rate-limiter.js';

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json());
app.use(cookieParser());

const loginLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 50,
  message: 'Too many login attempts. Please try again in a minute.'
});

const setupLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 50,
  message: 'Too many setup attempts. Please try again in a minute.'
});

let isStarting = true;
let isShuttingDown = false;

// Setup database on startup with unhandled rejection protection
setupDatabase().then(async () => {
  console.log('Database connected.');
  try {
    const { downloadQueue } = await import('./server/lib/download-queue.js');
    await downloadQueue.init();
  } catch (qErr) {
    console.error('Failed to initialize download queue on startup:', qErr);
  }
  try {
    const { libraryWatcher } = await import('./server/lib/watcher.js');
    await libraryWatcher.start();
  } catch (wErr) {
    console.error('Failed to initialize library watcher on startup:', wErr);
  }
  try {
    const { processingQueue } = await import('./server/lib/processing-queue.js');
    await processingQueue.init();
  } catch (pErr) {
    console.error('Failed to initialize processing queue on startup:', pErr);
  }
  isStarting = false;
}).catch((err) => {
  console.error('🚨 CRITICAL DATABASE INITIALIZATION FAILED:', err);
  process.exit(1);
});

// Robust Health and Readiness Check Endpoint
app.get('/health', async (req, res) => {
  if (isShuttingDown) {
    return res.status(503).json({
      status: 'unhealthy',
      version: '1.0.0',
      database: 'disconnected',
      error: 'Application is shutting down'
    });
  }

  if (isStarting) {
    return res.status(503).json({
      status: 'starting',
      version: '1.0.0',
      database: 'connecting'
    });
  }

  if (databaseCorrupted) {
    return res.status(503).json({
      status: 'unhealthy',
      version: '1.0.0',
      database: 'corrupted',
      error: databaseErrorMessage || 'Database corruption detected. Manual recovery required.'
    });
  }

  // 1. Verify database liveness
  try {
    await sqlite.execute('SELECT 1;');
  } catch (dbErr: any) {
    return res.status(503).json({
      status: 'unhealthy',
      version: '1.0.0',
      database: 'unavailable',
      error: dbErr?.message || 'Database is not responding'
    });
  }

  // 2. Verify required storage write access
  const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
  try {
    fs.accessSync(dataDir, fs.constants.R_OK | fs.constants.W_OK);
  } catch (storageErr: any) {
    return res.status(503).json({
      status: 'unhealthy',
      version: '1.0.0',
      database: 'connected',
      error: `Storage directory is inaccessible or read-only: ${storageErr?.message || 'Permission denied'}`
    });
  }

  res.json({
    status: 'ok',
    version: '1.0.0',
    database: 'connected'
  });
});

// Setup Setup Routes
import setupRoutes from './server/routes/setup.js';
app.post('/api/setup', setupLimiter);
app.use('/api/setup', setupRoutes);

import authRoutes from './server/routes/auth.js';
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);

// Add users routes (we will create this later)
import usersRoutes from './server/routes/users.js';
app.use('/api/users', usersRoutes);

import librariesRoutes from './server/routes/libraries.js';
app.use('/api/libraries', librariesRoutes);

import artistsRoutes from './server/routes/artists.js';
app.use('/api/artists', artistsRoutes);

import albumsRoutes from './server/routes/albums.js';
app.use('/api/albums', albumsRoutes);

import songsRoutes, { handleAudioStream } from './server/routes/songs.js';
app.use('/api/songs', songsRoutes);

// Dedicated /api/stream endpoints for MP3 streaming & playback compatibility
app.get('/api/stream/:id', requireAuth, handleAudioStream);
app.head('/api/stream/:id', requireAuth, handleAudioStream);
app.get('/api/stream/:id/audio', requireAuth, handleAudioStream);
app.head('/api/stream/:id/audio', requireAuth, handleAudioStream);

import karaokeRoutes from './server/routes/karaoke.js';
app.use('/api/karaoke', karaokeRoutes);

import downloaderRoutes from './server/routes/downloader.js';
app.use('/api/downloader', downloaderRoutes);

import playlistsRoutes from './server/routes/playlists.js';
app.use('/api/playlists', playlistsRoutes);

import favoritesRoutes from './server/routes/favorites.js';
app.use('/api/favorites', favoritesRoutes);

import searchRoutes from './server/routes/search.js';
app.use('/api/search', searchRoutes);

// Direct artwork serving route
app.get('/api/artwork/:filename', (req, res) => {
  const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.join(dataDir, 'artwork', safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Artwork not found' });
  }

  const ext = path.extname(safeFilename).toLowerCase();
  const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(filePath);
});

// API 404 handler: ensure all unhandled /api/* requests return JSON, never fallback to index.html
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
});

// API Error handler: ensure any error on /api/* routes returns JSON
app.use('/api', (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(`[API Error] ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || err.statusCode || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

async function startServer() {
  if (!isProd) {
    // Development mode: Use Vite's middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production mode: serve static files
    const clientDist = fs.existsSync(path.resolve(__dirname, 'client'))
      ? path.resolve(__dirname, 'client')
      : path.resolve(process.cwd(), 'dist/client');

    // Serve static files from clientDist (dist/client)
    app.use(express.static(clientDist, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        } else if (filePath.includes('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      }
    }));

    // Handle missing asset requests with 404 JSON error instead of falling back to SPA index.html
    app.all('/assets/*', (req, res) => {
      res.status(404).json({ error: 'Asset not found' });
    });

    // Fallback to index.html for SPA routes with no-cache headers
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.resolve(clientDist, 'index.html'));
    });
  }

  httpServer.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
  });
}

// Robust Graceful Shutdown handling for process termination
async function handleGracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[GracefulShutdown] Received ${signal}. Initiating graceful shutdown...`);

  // 1. Gracefully close active WebSockets
  try {
    console.log('[GracefulShutdown] Closing active WebSocket sessions...');
    for (const client of wss.clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.close(1001, 'Server is shutting down');
      }
    }
    wss.close();
  } catch (wsErr) {
    console.error('[GracefulShutdown] Error closing WebSockets:', wsErr);
  }

  // 2. Stop accepting new HTTP requests and close server
  try {
    console.log('[GracefulShutdown] Closing HTTP server...');
    httpServer.close((err) => {
      if (err) {
        console.error('[GracefulShutdown] Error closing HTTP server:', err);
      } else {
        console.log('[GracefulShutdown] HTTP server closed.');
      }
    });
  } catch (httpErr) {
    console.error('[GracefulShutdown] Error closing HTTP server:', httpErr);
  }

  // 3. Stop library watchers
  try {
    console.log('[GracefulShutdown] Stopping library watchers...');
    const { libraryWatcher } = await import('./server/lib/watcher.js');
    libraryWatcher.stopAll();
  } catch (watcherErr) {
    console.error('[GracefulShutdown] Error stopping library watchers:', watcherErr);
  }

  // 4. Safely checkpoint and close SQLite database to prevent WAL corruption
  try {
    console.log('[GracefulShutdown] Checkpointing and closing SQLite database...');
    await checkpointAndCloseDatabase();
  } catch (dbErr) {
    console.error('[GracefulShutdown] Error closing database:', dbErr);
  }

  console.log('[GracefulShutdown] Shutdown complete. Exiting.');
  process.exit(0);
}

process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));

startServer();
