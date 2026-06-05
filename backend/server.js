// TaskFlow API — Express + Postgres + Prometheus

import express from 'express';
import cors from 'cors';
import pg from 'pg';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { randomUUID } from 'crypto';
import client from 'prom-client';

const { Pool } = pg;
const PORT = process.env.PORT || 3000;
const DB_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/taskflow';

const pool = new Pool({
  connectionString: DB_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// ---------- Métriques Prometheus ----------
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const eventsReceivedTotal = new client.Counter({
  name: 'taskflow_events_received_total',
  help: 'Number of frontend events received',
  labelNames: ['event_name'],
  registers: [register],
});

// ---------- App ----------
const app = express();
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:4173'],
  credentials: true,
}));
app.use(express.json({ limit: '100kb' }));

app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
});

app.use(pinoHttp({
  logger,
  customProps: (req) => ({ request_id: req.id }),
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
}));

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const route = req.route ? req.route.path : req.path;
    const userId = req.headers['x-user-id'] || 'anonymous';
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    httpRequestDuration.labels(req.method, route, String(res.statusCode)).observe(duration);
    httpRequestsTotal.labels(req.method, route, String(res.statusCode)).inc();
  });
  next();
});

// ---------- Routes ----------
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.get('/api/tasks', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, title, done, created_at FROM tasks ORDER BY created_at DESC LIMIT 100');
    res.json(rows);
  } catch (err) { next(err); }
});

app.post('/api/tasks', async (req, res, next) => {
  try {
    const { title } = req.body;
    if (!title || title.length < 1) return res.status(400).json({ error: 'title required' });
    const { rows } = await pool.query(
      'INSERT INTO tasks (title) VALUES ($1) RETURNING id, title, done, created_at',
      [title]
    );
    req.log.info({ task_id: rows[0].id }, 'task created');
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

app.patch('/api/tasks/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE tasks SET done = $1 WHERE id = $2 RETURNING id, title, done, created_at',
      [Boolean(req.body.done), req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

app.delete('/api/tasks/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { next(err); }
});

app.post('/api/ingest', async (req, res, next) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    for (const e of events) {
      eventsReceivedTotal.labels(e.event_name || 'unknown').inc();
      await pool.query(
        `INSERT INTO events (event_name, user_id, session_id, properties, occurred_at)
         VALUES ($1, $2, $3, $4, COALESCE($5, NOW()))`,
        [e.event_name, e.user_id || null, e.session_id || null, e.properties || {}, e.occurred_at || null]
      );
    }
    res.status(202).json({ accepted: events.length });
  } catch (err) { next(err); }
});

app.get('/api/slow', async (req, res) => {
  await new Promise(r => setTimeout(r, 1500));
  res.json({ ok: true });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.use((err, req, res, next) => {
  req.log?.error({ err: err.message, stack: err.stack }, 'request failed');
  res.status(500).json({ error: 'internal' });
});

app.listen(PORT, () => logger.info(`TaskFlow API ready on http://localhost:${PORT}`));
