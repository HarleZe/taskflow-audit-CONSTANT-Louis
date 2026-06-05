-- Schéma initial TaskFlow
-- Chargé automatiquement par Postgres au premier démarrage du conteneur.

CREATE TABLE IF NOT EXISTS tasks (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  done         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id           BIGSERIAL PRIMARY KEY,
  event_name   TEXT NOT NULL,
  user_id      TEXT,
  session_id   TEXT,
  properties   JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_event_name ON events (event_name);
CREATE INDEX IF NOT EXISTS idx_events_session ON events (session_id);
CREATE INDEX IF NOT EXISTS idx_events_occurred ON events (occurred_at DESC);

-- Quelques tâches d'exemple
INSERT INTO tasks (title, done) VALUES
  ('Préparer le cours télémétrie', true),
  ('Tester docker-compose', true),
  ('Boire un café avant la session 1', false)
ON CONFLICT DO NOTHING;
