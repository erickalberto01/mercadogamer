# 🎮 Mercado Gamer

Página pública para comprar y vender cuentas de juegos (Free Fire, Clash of
Clans, Clash Royale, Roblox, Steam, Epic Games, PlayStation, Xbox, Nintendo
y otros), con contacto directo por WhatsApp, login propio con correo,
reseñas con estrellas y porcentaje de confianza del vendedor.

Hecha para el grupo de Facebook **"Cambio Y Ventas De Cuenta Clash of Clans
Y Clash Royale Y Cualquier Juego"** (7,000 miembros, administrado por Erick).

**URL esperada:** `https://mercadogamer.llallyeny.workers.dev`
(el subdominio depende de la cuenta de Cloudflare; se confirma al desplegar).

## Qué hace (v1)

- **Publicaciones:** título, juego, precio (DOP/USD), descripción, foto
  (URL opcional), vendedor y fecha. Botón de WhatsApp en cada publicación
  (`wa.me/<número del vendedor>`). Estado activa/vendida (el vendedor la
  marca). Contador de visualizaciones por publicación: sube al abrir el
  detalle y no se infla con recargas (cookie por publicación, 24 h).
- **Login propio:** registro e inicio de sesión con usuario o correo +
  contraseña. El registro pide correo electrónico (obligatorio y único).
  La contraseña se guarda como hash **SHA-256 con sal aleatoria**, nunca en
  texto plano. Sesión con cookie `httpOnly` y token aleatorio en D1 que
  vence a los 30 días. Cada usuario tiene su número de WhatsApp en el perfil.
- **Olvidé mi clave (revisión manual, sin correo):** el usuario pide el
  reseteo con su usuario o correo y su WhatsApp. El primer usuario
  registrado es el **admin** (Erick) y ve las solicitudes en su perfil, con
  el correo y WhatsApp registrados de la cuenta para verificar que quien
  pide es el dueño (el WhatsApp de la solicitud debe coincidir con el
  registrado). Al aprobar, se genera una **clave temporal** que se muestra
  UNA sola vez al admin, que se la pasa al usuario por WhatsApp; al entrar,
  el usuario debe cambiarla en su perfil ("Cambiar mi clave", pide la
  clave actual + la nueva). Al aprobar se cierran las sesiones de esa cuenta.
- **Juegos:** Free Fire, Clash of Clans, Clash Royale, Roblox, Steam, Epic
  Games, PlayStation, Xbox, Nintendo y Otro (con campo de texto libre para
  escribir el juego). El filtro "Otro" muestra los juegos personalizados.
- **Reseñas y confianza:** un usuario con sesión puede dejar una reseña
  (1–5 estrellas + comentario) a otro usuario. Una reseña por pareja
  (se puede actualizar). El perfil muestra: estrellas promedio,
  **porcentaje de confianza = (promedio / 5) × 100**, número de reseñas,
  sus publicaciones y las reseñas recibidas. Las estrellas y el % se ven
  también en cada publicación y en el detalle.
- **Portada:** buscador, filtro por juego, orden por más vistas o recientes.
  Aviso visible de seguridad: vender cuentas va contra las reglas de los
  juegos (Garena, Supercell, Roblox, Steam, Epic Games) y puede llevar a
  baneo; los tratos son bajo responsabilidad de cada uno; se recomienda
  intermediario de confianza.
- Diseño gaming oscuro con neón, mobile-first, todo en español.

## Qué hace (v5 — nuevo)

- **Editar y borrar publicaciones:** el dueño puede editar título, juego,
  precio, moneda, descripción y foto de sus publicaciones activas, y
  borrarlas (con confirmación). El admin también puede borrar cualquier
  publicación desde un reporte.
- **Reportar estafadores:** botón "Reportar" en cada publicación y en cada
  perfil. Motivos: Estafa, Cuenta falsa, Precio engañoso, Otro + comentario.
  El admin ve los reportes en su perfil y puede: borrar la publicación,
  **bloquear al usuario** (no puede entrar ni publicar) o descartar el
  reporte.
- **Tratos verificados:** al marcar una publicación como vendida, el
  vendedor puede escribir el usuario del comprador y el trato queda
  registrado. Las reseñas entre esas dos personas muestran
  "✓ Trato verificado"; las demás dicen "Sin verificar". El perfil muestra
  cuántas reseñas son verificadas.
- **Actividad del admin:** en su perfil, panel con contador de pendientes
  (reseteos + reportes sin resolver), las últimas publicaciones y las
  últimas reseñas.
- **Subir foto desde el celular:** en publicar y editar, campo de archivo
  (`accept="image/*"`, cámara o galería en el teléfono) con vista previa,
  máximo 2 MB (JPG, PNG, WebP, GIF, AVIF). Las fotos se guardan en el
  bucket R2 `mercadogamer-images` y se sirven desde `/img/...`. La URL
  sigue disponible como alternativa.
- **Móvil primero:** botones y campos grandes y cómodos al tacto
  (mínimo 48 px, texto de 16 px en los campos para que el celular no haga
  zoom al escribir).

## Arquitectura

Igual que la página de códigos Roblox de Erick:

- **Cloudflare Worker** (`src/index.js`): sirve el frontend estático y la
  API REST en `/api/*`.
- **Cloudflare D1** (`mercadogamer`): base de datos (tablas en
  `schema.sql`; el Worker también las crea solas en la primera llamada a
  la API, así que no hay que ejecutar el SQL a mano).
- **Cloudflare R2** (`mercadogamer-images`): depósito de las fotos subidas
  desde el celular (binding `IMAGES` en `wrangler.toml`). El Worker las
  sirve en `/img/...`.
- **Frontend** (`index.html`): una sola página (SPA) con todo el CSS y JS
  dentro. Sin build: se sube tal cual.
- **Despliegue:** push a GitHub → Cloudflare conectado al repo despliega
  solo. La API de Cloudflare desde la VM no funciona (error 6111), así que
  todo se hace por el panel.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Toda la página (diseño + lógica del navegador). |
| `src/index.js` | El Worker: API de auth, publicaciones, reseñas y vistas. |
| `wrangler.toml` | Configuración del Worker (nombre, assets, binding D1 y binding R2 `IMAGES`). |
| `schema.sql` | Tablas D1 (referencia; el Worker las crea solas). |
| `README.md` | Este archivo. |

## API (resumen)

| Ruta | Método | Qué hace |
|---|---|---|
| `/api/auth/register` | POST | Crea usuario (username, password, whatsapp). |
| `/api/auth/login` | POST | Entra y crea sesión (cookie `mg_session`). |
| `/api/auth/logout` | POST | Cierra sesión. |
| `/api/auth/me` | GET | Usuario actual o `null`. |
| `/api/auth/forgot-password` | POST | Crea solicitud de reseteo (login + whatsapp). Límite: 5 intentos por IP cada 10 min. |
| `/api/auth/change-password` | POST | Cambia la clave (sesión; clave actual + nueva). |
| `/api/admin/resets` | GET | Lista solicitudes de reseteo (solo admin). |
| `/api/admin/resets/:id/approve` | POST | Aprueba: genera clave temporal (solo admin; se muestra una sola vez). |
| `/api/admin/resets/:id/reject` | POST | Rechaza la solicitud (solo admin). |
| `/api/listings` | GET | Lista publicaciones activas (`?game=&q=&sort=recent\|views`). |
| `/api/listings` | POST | Crea publicación (sesión). |
| `/api/listings/:id` | GET | Detalle (+1 vista si no hay cookie). |
| `/api/listings/:id` | PATCH | Edita los campos (solo el dueño, solo si está activa) o cambia estado activa/vendida; con `buyer` registra el trato. |
| `/api/listings/:id` | DELETE | Borra la publicación (solo el dueño o el admin). |
| `/api/upload` | POST | Sube una foto (form-data `image`, máx. 2 MB; sesión). Devuelve `{url: "/img/..."}`. |
| `/img/:key` | GET | Sirve una foto subida desde R2. |
| `/api/reports` | POST | Crea un reporte (sesión; `listing_id` o `username`, `reason`, `comment`). |
| `/api/admin/reports` | GET | Lista reportes (solo admin). |
| `/api/admin/reports/:id/dismiss` | POST | Descarta el reporte (solo admin). |
| `/api/admin/reports/:id/delete_listing` | POST | Borra la publicación reportada (solo admin). |
| `/api/admin/reports/:id/ban_user` | POST | Bloquea al usuario reportado (solo admin). |
| `/api/admin/activity` | GET | Actividad reciente + contador de pendientes (solo admin). |
| `/api/reviews` | POST | Crea o actualiza reseña (sesión). |
| `/api/users/:username` | GET | Perfil: datos, confianza, publicaciones, reseñas. |
| `/api/users/:username/my-review` | GET | Mi reseña a ese usuario (sesión). |

Límites: login/registro, 10 intentos por IP cada 10 minutos. Los textos
de usuarios se escapan en el frontend (sin HTML inyectado).

## Despliegue (lo hace Erick en el panel de Cloudflare)

**Paso 1 — Crear la base D1**

1. Entra a [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** (menú izquierdo) → **D1 SQL Database** → **Create**.
2. Nombre: `mercadogamer` → **Create**.
3. Copia el **Database ID** que muestra la página de la base (un código
   largo con guiones, ej. `7072b926-...`).

**Paso 2 — Poner el ID en el repo**

1. En GitHub, abre el repo `erickalberto01/mercadogamer` → `wrangler.toml`
   → lápiz (editar).
2. Reemplaza `00000000-0000-0000-0000-000000000000` por el Database ID
   copiado. **Commit changes** (directo a `main`).
   - O pásale el ID a Muse y él actualiza el archivo y hace el push.

**Paso 3 — Conectar el Worker al repo**

1. En Cloudflare: **Workers & Pages** → **Create** → pestaña **Workers** →
   **Import a repository** (o "Connect to Git").
2. Elige la cuenta de GitHub y el repo `erickalberto01/mercadogamer` →
   **Begin setup**.
3. Configuración: Framework preset **None** (o déjalo como viene),
   rama `main`, comando de build vacío, y **Deploy**.
4. Cloudflare despliega el Worker. La URL aparece arriba: algo como
   `https://mercadogamer.llallyeny.workers.dev`.
5. Cada push nuevo al repo vuelve a desplegar solo.

**Paso 4 — Probar**

1. Abre la URL. Regístrate con un usuario de prueba, publica una cuenta,
   abre el detalle (la vista sube a 1), deja una reseña a otro usuario y
   revisa su perfil (estrellas + % de confianza).
2. Si algo da error 500, revisa en el panel: Workers & Pages →
   `mercadogamer` → **Settings** → **Bindings**: debe existir el binding
   **D1 `DB`** apuntando a la base `mercadogamer`.

## Después del despliegue

- Pon el link en el grupo de Facebook: descripción del grupo + un post
  fijado (Facebook esconde los posts normales con links).
- Erick es admin del grupo, pero en la página cualquier usuario registrado
  puede publicar; Erick debe registrarse como el **primer usuario** de la
  página (por ejemplo `erickromanp`) para quedar como **admin**
  automáticamente y poder aprobar los reseteos de clave. Si ya hay usuarios
  registrados y ninguno es admin, el más antiguo queda como admin solo.
- **Moderación en la página:** el admin revisa los reportes en su perfil
  (borrar publicación, bloquear usuario o descartar). Ya no hace falta
  borrar por consola D1, salvo casos raros.
- El bucket R2 `mercadogamer-images` debe existir antes de desplegar una
  versión que use el binding `IMAGES` (Workers & Pages → R2 → Create
  bucket). Si el despliegue falla por el binding, es por eso.

## Seguridad

- Las contraseñas nunca se guardan ni se devuelven en texto plano.
- Las sesiones son tokens aleatorios de 32 bytes con expiración.
- Los tratos y pagos ocurren fuera de la página (WhatsApp); la página no
  guarda dinero ni participa en los pagos.
- Vender cuentas de juegos viola las reglas de Garena, Supercell, Roblox,
  Steam y Epic Games:
  la página lo avisa en portada y en cada detalle, pero no puede evitar
  un baneo por parte del juego.
