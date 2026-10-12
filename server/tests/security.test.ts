import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import http from 'http';
import { requireAuth } from '../middleware/auth.js';

// Mock server for security testing
const app = express();
app.use(express.json());
// Apply the auth middleware
app.use((req, res, next) => {
  // Simple mock to simulate middleware flow for testing
  requireAuth(req as any, res, next);
});

// Sensitive test endpoints
app.post('/api/karaoke/sessions/:sessionId/skip', (req, res) => res.status(200).json({ success: true }));
app.post('/api/karaoke/sessions/:sessionId/queue', (req, res) => res.status(200).json({ success: true }));

let server: http.Server;
let baseUrl: string;

test('Security Audit: Unauthorized access test', async (t) => {
  // Start server
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  // Test unauthorized access
  const endpoints = [
    '/api/karaoke/sessions/123/skip',
    '/api/karaoke/sessions/123/queue'
  ];

  for (const endpoint of endpoints) {
    const res = await fetch(`${baseUrl}${endpoint}`, { method: 'POST' });
    assert.strictEqual(res.status, 401, `Endpoint ${endpoint} should be protected and return 401`);
  }

  server.close();
});
