-- Esquema de la base D1 para Mercado Gamer.
-- La base se crea en el panel de Cloudflare con el nombre "mercadogamer"
-- y su database_id va en wrangler.toml (ver README.md).
--
-- NOTA: el Worker también crea estas tablas solo en la primera llamada
-- a /api/ (ensureSchema en src/index.js), así que ejecutar este archivo
-- es opcional; está aquí como referencia y respaldo.
--
-- Contraseñas: NUNCA se guardan en texto plano. Se guarda el hash
-- SHA-256 de (sal + ":" + contraseña) con una sal aleatoria por usuario.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  game TEXT NOT NULL,
  price REAL NOT NULL,
  currency TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'activa',
  views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reviewer_id INTEGER NOT NULL,
  reviewed_id INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  comment TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(reviewer_id, reviewed_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS throttle (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listings_game ON listings (game);
CREATE INDEX IF NOT EXISTS idx_listings_created ON listings (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_views ON listings (views DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewed ON reviews (reviewed_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
