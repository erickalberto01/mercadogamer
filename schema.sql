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
  email TEXT,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  is_banned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Solicitudes de reseteo de clave (revisión manual por el admin).
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  whatsapp_contacto TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
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

-- Reportes de estafa (los revisa el admin en su perfil).
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL,
  listing_id INTEGER,
  reported_user_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'pendiente',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

-- Tratos cerrados: el vendedor marca una publicación como vendida y elige
-- al comprador. Una reseña entre esas dos personas es "trato verificado".
CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  seller_id INTEGER NOT NULL,
  buyer_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets (user_id);
CREATE INDEX IF NOT EXISTS idx_resets_status ON password_resets (status);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status);
CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports (reported_user_id);
CREATE INDEX IF NOT EXISTS idx_deals_parties ON deals (seller_id, buyer_id);
CREATE INDEX IF NOT EXISTS idx_deals_listing ON deals (listing_id);
