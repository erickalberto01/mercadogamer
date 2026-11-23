// Worker de Mercado Gamer: sirve los assets estáticos y la API (login, publicaciones, reseñas).
// No contiene secretos: las contraseñas se guardan como hash SHA-256 con sal,
// y las sesiones viven en D1. Nunca se escribe una contraseña en texto plano.
//
// Tablas D1 (se crean solas en la primera llamada a /api/, ver ensureSchema
// y schema.sql): users, listings, reviews, sessions, throttle.

var GAMES = ['Free Fire', 'Clash of Clans', 'Clash Royale', 'Roblox', 'Otro'];
var SESSION_DAYS = 30;
var LOGIN_WINDOW_MS = 10 * 60 * 1000;
var LOGIN_MAX_ATTEMPTS = 10;

function json(data, status, extraHeaders) {
  var headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  if (extraHeaders) {
    for (var k in extraHeaders) headers[k] = extraHeaders[k];
  }
  return new Response(JSON.stringify(data), { status: status, headers: headers });
}

function getClientIp(request) {
  var cf = request.headers.get('CF-Connecting-IP');
  if (cf) return cf.trim();
  var forwarded = request.headers.get('X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}

async function sha256Hex(text) {
  var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map(function (b) { return b.toString(16).padStart(2, '0'); })
    .join('');
}

function randomHex(bytes) {
  var arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function parseCookies(request) {
  var out = {};
  var header = request.headers.get('Cookie') || '';
  header.split(';').forEach(function (part) {
    var idx = part.indexOf('=');
    if (idx > 0) {
      var name = part.slice(0, idx).trim();
      var value = part.slice(idx + 1).trim();
      try { out[name] = decodeURIComponent(value); } catch (e) { out[name] = value; }
    }
  });
  return out;
}

function sessionCookie(token, maxAgeSeconds) {
  var parts = ['mg_session=' + token, 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/'];
  if (maxAgeSeconds !== undefined) parts.push('Max-Age=' + maxAgeSeconds);
  return parts.join('; ');
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    whatsapp: row.whatsapp,
    created_at: row.created_at,
    avg_stars: row.avg_stars === null || row.avg_stars === undefined ? null : Math.round(row.avg_stars * 10) / 10,
    review_count: row.review_count || 0,
    trust_pct: row.avg_stars === null || row.avg_stars === undefined ? 0 : Math.round((row.avg_stars / 5) * 100),
  };
}

async function getSessionUser(request, env) {
  var cookies = parseCookies(request);
  var token = cookies.mg_session;
  if (!token) return null;
  var now = Date.now();
  var session = await env.DB.prepare(
    'SELECT user_id, expires_at FROM sessions WHERE token = ?',
  ).bind(token).first();
  if (!session || session.expires_at < now) {
    if (session) {
      await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    }
    return null;
  }
  var user = await env.DB.prepare(
    'SELECT id, username, whatsapp, created_at FROM users WHERE id = ?',
  ).bind(session.user_id).first();
  return user || null;
}

async function throttleCheck(env, key, windowMs, maxAttempts) {
  var now = Date.now();
  var row = await env.DB.prepare('SELECT count, window_start FROM throttle WHERE key = ?').bind(key).first();
  if (!row || now - row.window_start >= windowMs) {
    await env.DB.prepare(
      'INSERT INTO throttle (key, count, window_start) VALUES (?, 1, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start',
    ).bind(key, now).run();
    return true;
  }
  if (row.count >= maxAttempts) return false;
  await env.DB.prepare('UPDATE throttle SET count = count + 1 WHERE key = ?').bind(key).run();
  return true;
}

async function throttleReset(env, key) {
  await env.DB.prepare('DELETE FROM throttle WHERE key = ?').bind(key).run();
}

async function ensureSchema(env) {
  var statements = [
    'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, whatsapp TEXT NOT NULL, created_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS listings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, game TEXT NOT NULL, price REAL NOT NULL, currency TEXT NOT NULL, description TEXT, image_url TEXT, status TEXT NOT NULL DEFAULT \'activa\', views INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, reviewer_id INTEGER NOT NULL, reviewed_id INTEGER NOT NULL, stars INTEGER NOT NULL, comment TEXT, created_at INTEGER NOT NULL, UNIQUE(reviewer_id, reviewed_id))',
    'CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS throttle (key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL)',
    'CREATE INDEX IF NOT EXISTS idx_listings_game ON listings (game)',
    'CREATE INDEX IF NOT EXISTS idx_listings_created ON listings (created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_listings_views ON listings (views DESC)',
    'CREATE INDEX IF NOT EXISTS idx_reviews_reviewed ON reviews (reviewed_id)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)',
  ];
  for (var i = 0; i < statements.length; i++) {
    await env.DB.prepare(statements[i]).run();
  }
}

async function readJson(request) {
  try {
    var data = await request.json();
    return data && typeof data === 'object' ? data : null;
  } catch (e) {
    return null;
  }
}

function isValidImageUrl(value) {
  if (!value) return true;
  if (typeof value !== 'string' || value.length > 500) return false;
  return /^https?:\/\/.+/i.test(value.trim());
}

// ---------- Auth ----------

async function register(request, env) {
  var data = await readJson(request);
  if (!data) return json({ error: 'El cuerpo debe ser JSON válido.' }, 400);
  var username = typeof data.username === 'string' ? data.username.trim().toLowerCase() : '';
  var password = typeof data.password === 'string' ? data.password : '';
  var whatsapp = digitsOnly(data.whatsapp);
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return json({ error: 'El usuario debe tener de 3 a 20 caracteres: letras, números o guion bajo.' }, 400);
  }
  if (password.length < 6 || password.length > 100) {
    return json({ error: 'La contraseña debe tener al menos 6 caracteres.' }, 400);
  }
  if (whatsapp.length < 7 || whatsapp.length > 15) {
    return json({ error: 'Escribe un número de WhatsApp válido (solo dígitos, con código de país).' }, 400);
  }
  var ipHash = await sha256Hex(getClientIp(request));
  if (!await throttleCheck(env, 'register:' + ipHash, LOGIN_WINDOW_MS, LOGIN_MAX_ATTEMPTS)) {
    return json({ error: 'Demasiados intentos. Espera 10 minutos.' }, 429);
  }
  var existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) return json({ error: 'Ese nombre de usuario ya está en uso.' }, 409);
  var salt = randomHex(16);
  var hash = await sha256Hex(salt + ':' + password);
  var now = Date.now();
  var inserted = await env.DB.prepare(
    'INSERT INTO users (username, password_hash, salt, whatsapp, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(username, hash, salt, whatsapp, now).run();
  var userId = inserted.meta && inserted.meta.last_row_id;
  return loginWithUser(env, userId, now);
}

async function loginWithUser(env, userId, now) {
  var token = randomHex(32);
  var expiresAt = (now || Date.now()) + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
  ).bind(token, userId, expiresAt).run();
  var user = await env.DB.prepare(
    'SELECT id, username, whatsapp, created_at FROM users WHERE id = ?',
  ).bind(userId).first();
  return json(
    { ok: true, user: { id: user.id, username: user.username, whatsapp: user.whatsapp } },
    200,
    { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 24 * 60 * 60) },
  );
}

async function login(request, env) {
  var data = await readJson(request);
  if (!data) return json({ error: 'El cuerpo debe ser JSON válido.' }, 400);
  var username = typeof data.username === 'string' ? data.username.trim().toLowerCase() : '';
  var password = typeof data.password === 'string' ? data.password : '';
  var ipHash = await sha256Hex(getClientIp(request));
  if (!await throttleCheck(env, 'login:' + ipHash, LOGIN_WINDOW_MS, LOGIN_MAX_ATTEMPTS)) {
    return json({ error: 'Demasiados intentos. Espera 10 minutos.' }, 429);
  }
  var user = await env.DB.prepare(
    'SELECT id, username, password_hash, salt, whatsapp FROM users WHERE username = ?',
  ).bind(username).first();
  if (!user) return json({ error: 'Usuario o contraseña incorrectos.' }, 401);
  var hash = await sha256Hex(user.salt + ':' + password);
  if (hash !== user.password_hash) return json({ error: 'Usuario o contraseña incorrectos.' }, 401);
  await throttleReset(env, 'login:' + ipHash);
  return loginWithUser(env, user.id, Date.now());
}

async function logout(request, env) {
  var cookies = parseCookies(request);
  if (cookies.mg_session) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(cookies.mg_session).run();
  }
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}

async function me(request, env) {
  var user = await getSessionUser(request, env);
  if (!user) return json({ user: null }, 200);
  return json({ user: { id: user.id, username: user.username, whatsapp: user.whatsapp } }, 200);
}

// ---------- Listings ----------

function listingRow(row) {
  var seller = {
    id: row.seller_id,
    username: row.seller_username,
    whatsapp: row.seller_whatsapp,
    avg_stars: row.avg_stars === null ? null : Math.round(row.avg_stars * 10) / 10,
    review_count: row.review_count || 0,
    trust_pct: row.avg_stars === null ? 0 : Math.round((row.avg_stars / 5) * 100),
  };
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    game: row.game,
    price: row.price,
    currency: row.currency,
    description: row.description,
    image_url: row.image_url,
    status: row.status,
    views: row.views,
    created_at: row.created_at,
    seller: seller,
  };
}

var LISTING_SELECT =
  'SELECT l.id, l.user_id, l.title, l.game, l.price, l.currency, l.description, l.image_url, ' +
  'l.status, l.views, l.created_at, u.id AS seller_id, u.username AS seller_username, ' +
  'u.whatsapp AS seller_whatsapp, ' +
  '(SELECT AVG(stars) FROM reviews r WHERE r.reviewed_id = u.id) AS avg_stars, ' +
  '(SELECT COUNT(*) FROM reviews r WHERE r.reviewed_id = u.id) AS review_count ' +
  'FROM listings l JOIN users u ON u.id = l.user_id ';

async function listListings(request, env) {
  var url = new URL(request.url);
  var game = url.searchParams.get('game') || '';
  var q = (url.searchParams.get('q') || '').trim();
  var sort = url.searchParams.get('sort') === 'views' ? 'views' : 'recent';
  var conditions = ["l.status = 'activa'"];
  var params = [];
  if (game && GAMES.indexOf(game) >= 0) {
    conditions.push('l.game = ?');
    params.push(game);
  }
  if (q) {
    conditions.push('(l.title LIKE ? OR l.description LIKE ?)');
    params.push('%' + q + '%', '%' + q + '%');
  }
  var order = sort === 'views'
    ? 'ORDER BY l.views DESC, l.created_at DESC, l.id DESC'
    : 'ORDER BY l.created_at DESC, l.id DESC';
  var rows = await env.DB.prepare(
    LISTING_SELECT + 'WHERE ' + conditions.join(' AND ') + ' ' + order + ' LIMIT 100',
  ).bind(...params).all();
  return json((rows.results || []).map(listingRow), 200);
}

async function getListing(request, env, id) {
  var row = await env.DB.prepare(LISTING_SELECT + 'WHERE l.id = ?').bind(id).first();
  if (!row) return json({ error: 'La publicación no existe.' }, 404);
  var cookies = parseCookies(request);
  var seenKey = 'mg_seen_' + id;
  var headers = {};
  if (!cookies[seenKey]) {
    await env.DB.prepare('UPDATE listings SET views = views + 1 WHERE id = ?').bind(id).run();
    row.views = (row.views || 0) + 1;
    headers['Set-Cookie'] = seenKey + '=1; Path=/; Max-Age=86400; SameSite=Lax';
  }
  return json(listingRow(row), 200, headers);
}

async function createListing(request, env) {
  var user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Inicia sesión para publicar.' }, 401);
  var data = await readJson(request);
  if (!data) return json({ error: 'El cuerpo debe ser JSON válido.' }, 400);
  var title = typeof data.title === 'string' ? data.title.trim() : '';
  var game = typeof data.game === 'string' ? data.game.trim() : '';
  var price = Number(data.price);
  var currency = typeof data.currency === 'string' ? data.currency.trim().toUpperCase() : '';
  var description = typeof data.description === 'string' ? data.description.trim() : '';
  var imageUrl = typeof data.image_url === 'string' ? data.image_url.trim() : '';
  if (title.length < 3 || title.length > 100) {
    return json({ error: 'El título debe tener entre 3 y 100 caracteres.' }, 400);
  }
  if (GAMES.indexOf(game) < 0) {
    return json({ error: 'Elige un juego de la lista.' }, 400);
  }
  if (!isFinite(price) || price <= 0 || price > 1000000) {
    return json({ error: 'Escribe un precio válido.' }, 400);
  }
  if (currency !== 'DOP' && currency !== 'USD') {
    return json({ error: 'La moneda debe ser DOP o USD.' }, 400);
  }
  if (description.length > 1000) {
    return json({ error: 'La descripción debe tener como máximo 1000 caracteres.' }, 400);
  }
  if (!isValidImageUrl(imageUrl)) {
    return json({ error: 'La foto debe ser una URL válida que empiece con http:// o https://.' }, 400);
  }
  var now = Date.now();
  var inserted = await env.DB.prepare(
    'INSERT INTO listings (user_id, title, game, price, currency, description, image_url, status, views, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, \'activa\', 0, ?)',
  ).bind(user.id, title, game, price, currency, description || null, imageUrl || null, now).run();
  var id = inserted.meta && inserted.meta.last_row_id;
  return json({ ok: true, id: id }, 201);
}

async function updateListing(request, env, id) {
  var user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Inicia sesión.' }, 401);
  var data = await readJson(request);
  if (!data) return json({ error: 'El cuerpo debe ser JSON válido.' }, 400);
  var status = typeof data.status === 'string' ? data.status.trim() : '';
  if (status !== 'activa' && status !== 'vendida') {
    return json({ error: 'El estado debe ser activa o vendida.' }, 400);
  }
  var row = await env.DB.prepare('SELECT user_id FROM listings WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'La publicación no existe.' }, 404);
  if (row.user_id !== user.id) return json({ error: 'Solo el vendedor puede cambiar esta publicación.' }, 403);
  await env.DB.prepare('UPDATE listings SET status = ? WHERE id = ?').bind(status, id).run();
  return json({ ok: true }, 200);
}

// ---------- Users & reviews ----------

async function getUserProfile(env, username) {
  var user = await env.DB.prepare(
    'SELECT u.id, u.username, u.whatsapp, u.created_at, ' +
    '(SELECT AVG(stars) FROM reviews r WHERE r.reviewed_id = u.id) AS avg_stars, ' +
    '(SELECT COUNT(*) FROM reviews r WHERE r.reviewed_id = u.id) AS review_count ' +
    'FROM users u WHERE u.username = ?',
  ).bind(username).first();
  if (!user) return null;
  var listings = await env.DB.prepare(
    LISTING_SELECT + 'WHERE l.user_id = ? ORDER BY l.created_at DESC, l.id DESC LIMIT 50',
  ).bind(user.id).all();
  var reviews = await env.DB.prepare(
    'SELECT r.id, r.stars, r.comment, r.created_at, u.username AS reviewer ' +
    'FROM reviews r JOIN users u ON u.id = r.reviewer_id ' +
    'WHERE r.reviewed_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 100',
  ).bind(user.id).all();
  return {
    user: publicUser(user),
    listings: (listings.results || []).map(listingRow),
    reviews: reviews.results || [],
  };
}

async function createReview(request, env) {
  var user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Inicia sesión para dejar una reseña.' }, 401);
  var data = await readJson(request);
  if (!data) return json({ error: 'El cuerpo debe ser JSON válido.' }, 400);
  var reviewedUsername = typeof data.reviewed === 'string' ? data.reviewed.trim().toLowerCase() : '';
  var stars = Number(data.stars);
  var comment = typeof data.comment === 'string' ? data.comment.trim() : '';
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return json({ error: 'Las estrellas deben ser de 1 a 5.' }, 400);
  }
  if (comment.length > 500) {
    return json({ error: 'El comentario debe tener como máximo 500 caracteres.' }, 400);
  }
  var reviewed = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(reviewedUsername).first();
  if (!reviewed) return json({ error: 'Ese usuario no existe.' }, 404);
  if (reviewed.id === user.id) {
    return json({ error: 'No puedes dejarte una reseña a ti mismo.' }, 400);
  }
  var now = Date.now();
  await env.DB.prepare(
    'INSERT INTO reviews (reviewer_id, reviewed_id, stars, comment, created_at) VALUES (?, ?, ?, ?, ?) ' +
    'ON CONFLICT(reviewer_id, reviewed_id) DO UPDATE SET stars = excluded.stars, comment = excluded.comment, created_at = excluded.created_at',
  ).bind(user.id, reviewed.id, stars, comment || null, now).run();
  return json({ ok: true }, 201);
}

async function getMyReview(request, env, reviewedUsername) {
  var user = await getSessionUser(request, env);
  if (!user) return json({ review: null }, 200);
  var row = await env.DB.prepare(
    'SELECT r.stars, r.comment FROM reviews r JOIN users u ON u.id = r.reviewed_id ' +
    'WHERE r.reviewer_id = ? AND u.username = ?',
  ).bind(user.id, reviewedUsername).first();
  return json({ review: row || null }, 200);
}

// ---------- Router ----------

export default {
  async fetch(request, env, ctx) {
    var url = new URL(request.url);
    var path = url.pathname;

    if (path.startsWith('/api/')) {
      try { await ensureSchema(env); } catch (e) { /* ver nota en ensureSchema */ }

      if (path === '/api/auth/register' && request.method === 'POST') return register(request, env);
      if (path === '/api/auth/login' && request.method === 'POST') return login(request, env);
      if (path === '/api/auth/logout' && request.method === 'POST') return logout(request, env);
      if (path === '/api/auth/me' && request.method === 'GET') return me(request, env);

      if (path === '/api/listings' && request.method === 'GET') return listListings(request, env);
      if (path === '/api/listings' && request.method === 'POST') return createListing(request, env);

      if (path.startsWith('/api/listings/')) {
        var id = Number(path.slice('/api/listings/'.length));
        if (!Number.isInteger(id) || id <= 0) return json({ error: 'La publicación no existe.' }, 404);
        if (request.method === 'GET') return getListing(request, env, id);
        if (request.method === 'PATCH') return updateListing(request, env, id);
        return json({ error: 'Método no permitido.' }, 405);
      }

      if (path === '/api/reviews' && request.method === 'POST') return createReview(request, env);

      if (path.startsWith('/api/users/')) {
        var rest = decodeURIComponent(path.slice('/api/users/'.length));
        var parts = rest.split('/');
        var username = (parts[0] || '').toLowerCase();
        if (!username) return json({ error: 'Usuario no válido.' }, 400);
        if (parts.length === 2 && parts[1] === 'my-review' && request.method === 'GET') {
          return getMyReview(request, env, username);
        }
        if (parts.length === 1 && request.method === 'GET') {
          var profile = await getUserProfile(env, username);
          if (!profile) return json({ error: 'Ese usuario no existe.' }, 404);
          return json(profile, 200);
        }
        return json({ error: 'Método no permitido.' }, 405);
      }

      return json({ error: 'Ruta no encontrada.' }, 404);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('Assets binding not configured', { status: 500 });
  },
};
