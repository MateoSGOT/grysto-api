# GRYSTO API — CLAUDE.md

GRYSTO es una app de entrenamiento de baloncesto (freemium, $5/mes premium).
Este repo es la **API REST** (Node.js). El frontend Flutter vive en
`C:\proyectos\grysto-app`.

> **GOTCHA de ruta**: este repo está en `C:\proyectos\grystodb\grysto-api`
> (dentro de `grystodb`, que contiene un junction). `C:\proyectos\grysto-api`
> NO existe — un find/glob sobre `C:\proyectos` directo no lo encuentra.

## Stack

Node ≥20 (CommonJS) · Express 5 · MongoDB Atlas + Mongoose · Zod (validación
de entrada) · JWT (access + refresh) · Jest + Supertest (tests).

## Arquitectura — capas estrictas

```
routes → controllers → services → models
   ↑ validators (Zod) como middleware en el borde
```

Flujo de una request: `routes/*.routes.js` monta middlewares
(`authenticate` → `requireRole` → `validate(schema)`) → el controller
(`asyncHandler`, sin lógica de negocio) llama al service → el service
contiene TODA la lógica de negocio y lanza `ApiError` tipado → el
`error.middleware` lo traduce a HTTP. Mongoose models en `src/models/`
(re-exportados por `models/index.js`).

- Nunca meter lógica de negocio en controllers ni queries en controllers.
- Errores siempre vía `ApiError.notFound()/forbidden()/conflict()/...`.
- Enums SIEMPRE desde `src/constants/enums.js` (frozen) — jamás strings
  hardcodeados. Incluye ROLES, PLANS, LEVELS, POSITIONS, GOALS,
  EXERCISE_CATEGORIES, ROUTINE_CATEGORIES, PLAN_STATUS, PLAN_SOURCE, etc.
- El recurso `exercise.*` es el patrón canónico para un recurso nuevo:
  model + validator + service + controller + route + test de integración.

## Convención de respuesta

Envelope universal vía `utils/ApiResponse`:

```json
{ "success": true, "message": "…", "data": { … } }
```

Claves de `data` por recurso (verificadas en controllers):

| Endpoint | data |
|---|---|
| exercises | `{ exercise }` / lista paginada |
| routines | `{ routine }` (detalle con exercises poblados) |
| weekly-plans | `{ weeklyPlan }` |
| my-plan (GET/activate/abandon) | `{ plan }` (GET incluye `currentCycleData`) |
| my-plan/confirm-day | `{ cycleCompleted, currentCycle, plan }` |
| my-plan/confirm-load, adjust-load | `{ load }` |
| my-plan/progression-preview | `{ currentCycle, nextCycle, preview }` |
| auth (login/refresh) | `{ user, accessToken, refreshToken }` |
| auth/me | `{ user }` |
| coach/chat | `{ conversationId, reply, provider, model, tokens…, estimatedCostUSD }` |
| coach/conversations | `{ conversations }` / `{ conversation }` |

## Dominio clave: planes con ciclos y sobrecarga progresiva

- `WeeklyPlan` = plantilla de exactamente 7 días (días con `category`,
  `title`, `isRestDay`, `routines[]`). `UserPlan` = instancia por usuario con
  `cycles[]`; cada ciclo tiene `daysProgress[]` (7 días) y `loads[]` (una
  carga por ejercicio único, con métrica/unidad según categoría).
- **"Hoy" NO es calendario**: es el primer día no completado del
  `daysProgress` del ciclo actual.
- `confirm-day` marca el día; al completar los 7, `startNewCycle()` abre el
  ciclo N+1 con cargas progresadas según `constants/progression.js`
  (tabla configurable por categoría: fuerza +2.5 kg, salto +2 cm, tiro +5 %…).
  El plan nunca "termina", cicla indefinidamente.
- **CALIBRACIÓN SOBRE LA MARCHA** (las cargas): el sistema no puede adivinar
  cuánto peso/salto/tiro hace un usuario, así que cada carga (`cycles[].loads[]`)
  nace **SIN CALIBRAR** — `suggestedValue: null`, `calibrated: false` — con su
  `metric`/`unit` correctos por categoría (eso sí se sabe). La **primera**
  `confirm-load` de un ejercicio registra su marca real, la fija como base y
  pone `calibrated: true`. La sobrecarga del ciclo siguiente parte de ese valor
  REAL; un ejercicio nunca calibrado se mantiene en `null` (no se inventa
  progresión). `confirm-load`/`adjust-load` validan el valor contra el rango de
  su métrica (`validateMetricValue` en progression.js). Invariante:
  `suggestedValue != null ⇔ calibrated`.
- Reglas free/premium en `userPlan.service.activatePlan`: free no cambia de
  plan (salvo que el actual sea `recommended`); abandonar es premium-only.
- Al verificar email se auto-recomienda un plan por match-score contra el
  `PlayerProfile` (`auth.service.recommendPlan`).
- **Cambio de plan con carry-load (premium)** — `userPlan.service.changePreview` /
  `changePlan`, expuestos como `GET /weekly-plans/:id/change-preview` y
  `POST /weekly-plans/:id/change`. Un usuario acumula VARIOS userplans (uno
  `active`, el resto historial). Al cambiar: se cruzan por `category` las cargas
  CALIBRADAS del ciclo actual con los ejercicios del plan destino → el usuario
  decide por cada match `carry_load` (lleva su valor real ya confirmado:
  `calibrated:true, confirmed:true`) o `recalibrate` (arranca sin calibrar). El
  sistema nunca inventa el número. `metric`/`unit` se derivan de la `category`,
  así que dentro de una categoría siempre coinciden (el guard de mismatch es
  defensivo/inalcanzable). Transacción (patrón `DELETE /auth/account`): cierra el
  ciclo actual (`completedAt`), pasa el viejo a `status: 'switched'` y crea el
  nuevo `active` — atómico, nunca dos `active`. El historial de cargas vive en
  los `cycles` de los userplans `switched`/`completed` (NO se toca
  `WorkoutHistory`, que es de sesiones).
- **⚠️ Atlas**: `userplans.status` ahora usa `'switched'` (nuevo en el enum).
  **Hay que agregarlo A MANO al validador `$jsonSchema` de `userplans` en
  Compass** o los writes de cambio de plan fallarán con "Document failed
  validation" en vivo (los tests usan MongoMemoryReplSet, sin validador).
- `GET /weekly-plans` acepta filtros `level`/`goal`/`position` (alias de los
  arrays `targetLevel`/`targetGoal`/`targetPosition`) y agrega `isCurrentPlan`
  por item. `GET /weekly-plans/:id` puebla `days.routines.exercises.exerciseId`
  (nombre+categoría) para el detalle/preview.

## Ejercicios: video de guía (`demoVideo`)

`Exercise.demoVideo = { type, cloudinaryUrl, youtubeUrl }`. `type` (enum
`VIDEO_TYPES`) es **`cloudinary`** (MP4 directo, reproductor propio en la app —
preferido) o **`youtube`** (legacy). El Zod exige la URL que corresponde al
`type` (`cloudinaryUrl` si cloudinary, `youtubeUrl` si youtube). El validator
de Atlas de `exercises` **ya permite `cloudinaryUrl`** (`["string","null"]`, no
en `required`), así que no hay que tocar Atlas para usar MP4.

## Sustitución de ejercicios (override por usuario)

El usuario puede **sustituir** un ejercicio de su plan por otro **equivalente
(misma categoría)**. Las rutinas del catálogo son **compartidas** y NO se
tocan; la sustitución vive como override en el `UserPlan`:
`substitutions: [{ originalExerciseId, newExerciseId, category, substitutedAt }]`.
`originalExerciseId` es SIEMPRE el ancla del catálogo; re-sustituir **actualiza**
`newExerciseId` (no acumula). Al sustituir, el load del ciclo actual del saliente
se reemplaza por uno del nuevo **SIN CALIBRAR** (metric/unit por categoría);
ciclos pasados y días completados no se tocan.

- `POST /my-plan/substitute-exercise` `{ originalExerciseId, newExerciseId }` →
  valida existencia (404), **misma categoría** (422) y que el saliente esté en
  el plan. Devuelve `{ plan }` con `substitutions` y el load nuevo.
- `GET /exercises/:id/alternatives` → `{ category, alternatives[] }` (mismos de
  la categoría, excluyéndose). Exercises no tienen gating premium.
- **Read-side (D.1)**: `routine.service.getById` aplica las sustituciones del
  usuario autenticado con plan activo — `GET /routines/:id` devuelve el
  sustituto (la prescripción sets/reps se mantiene). Acepta
  `{ applySubstitutions: false }` para un futuro "explorar catálogo".

## Auth

JWT access (corto) + refresh con **rotación en cada uso y detección de
reuso** (`RefreshToken` model): un refresh token reutilizado invalida la
familia completa ("sesión comprometida"). Rate limits por endpoint en
`middlewares/rateLimit.middleware.js` (el del coach es por usuario: 20 msg /
15 min).

### Verificación y reset por CÓDIGO de 6 dígitos (sin links ni deep links)

`services/authCode.service.js` + model `AuthCode` (colección `authCodes`) +
política en `constants/authCodes.js` (TTL 10 min, 5 intentos, cooldown 60 s,
5 envíos/hora por usuario y propósito, purga TTL a las 24 h).

- Código con `crypto.randomInt`; se guarda SOLO `HMAC-SHA256(purpose:userId:code)`.
  Incluir `purpose` y `userId` impide usar un código de verificación para reset
  (y viceversa) o para otro usuario. Un solo uso (`usedAt`); emitir uno nuevo
  invalida el anterior del mismo propósito; consumo e intentos con updates
  condicionales (atómicos).
- **Clave HMAC**: `AUTH_CODE_SECRET`. Si falta, se DERIVA de
  `JWT_REFRESH_SECRET` (fallback de desarrollo). **En producción (Render) va
  una `AUTH_CODE_SECRET` propia** (larga, aleatoria). Cambiarla invalida los
  códigos vigentes (vencen en 10 min, sin más impacto).
- Endpoints (`/auth`): `register` (envía código) · `verify-email {email, code}`
  → **inicia sesión** (`user, accessToken, refreshToken, recommendedPlan`) ·
  `resend-verification {email}` · `login` no verificado → **403
  `EMAIL_NOT_VERIFIED`** con `details.resendAvailableInSeconds` (y reenvía si
  el cooldown lo permite) · `forgot-password {email}` (SIEMPRE el mismo 200,
  cooldown silencioso, anti-enumeración) · `reset-password {email, code,
  newPassword}` → revoca TODOS los refresh tokens, no inicia sesión.
- Errores con `code` top-level: `CODE_INVALID` (+`details.attemptsRemaining`),
  `CODE_EXPIRED`, `CODE_TOO_MANY_ATTEMPTS` (400) · `RESEND_COOLDOWN`,
  `RESEND_LIMIT` (429, +`details.retryAfterSeconds`) · `ALREADY_VERIFIED` (409).
  Email inexistente en verify/reset → `CODE_INVALID` sin detalle.
- `recommendPlan` en verify es best-effort: si falla, se loguea y devuelve
  `recommendedPlan: null` (el usuario activa desde el catálogo).
- Email (`email.service.js`): remitente = `EMAIL_FROM` (cambiar al dominio
  verificado NO toca código). Resend v6 **no lanza** ante errores de la API:
  devuelve `{ error }` y se trata como no enviado. Sin dominio verificado,
  Resend solo entrega desde `onboarding@resend.dev` al email dueño de la cuenta.
- Tests: `captureEmailCodes()` / `ageAuthCodes()` en `tests/fixtures.js`
  (el código en claro solo existe en el email).
- `FRONTEND_URL` es SOLO el origen de CORS; no hay links en los emails.

### Activación de plan sin plan activo

`activatePlan`: sin plan activo → free y premium activan directo (premium-only
para planes `isPremium`; plan inactivo → 404). Plan activo **colgante**
(`planUnavailable`) → se cierra como `abandoned` y se activa el nuevo en UNA
transacción (free o premium). Free con plan recomendado → mismo reemplazo
transaccional. `GET /weekly-plans` muestra solo `isActive: true` a no-admins.
Índice único parcial `{userId}` con `status:'active'` en `userPlans`: se crea
A MANO en Atlas (no está en el schema para que autoIndex no lo cree solo); el
service traduce su E11000 a 409 "Ya tienes un plan activo".

## Coach IA

Fachada agnóstica al proveedor (`services/ai/ai.service.js` + adapters en
`providers/`): Gemini (default, free tier) y Anthropic. Costos estimados por
mensaje (`constants/aiPricing.js`) persistidos en `CoachConversation`.

**Contexto que recibe el coach** (`CoachConversation.buildContext(profile,
planContext)`): system prompt + `PlayerProfile` (JSON) + **contexto del plan
de hoy** + historial completo de la conversación.
- El **contexto del plan** lo arma `services/ai/coachContext.js`
  (`resolveCoachContext(userId)` → texto): día de hoy (primer día no completado
  del ciclo) con su categoría, **los ejercicios concretos de hoy** (nombre +
  sets×reps o tiempo) y el **estado de cada carga** — distingue CALIBRADA
  (muestra el valor real) de **SIN REGISTRAR** (aún no calibrada). Tolera plan
  nulo (devuelve null; el chat no se rompe). Usa los ejercicios del plan tal
  cual, sin aplicar sustituciones del usuario (mejora pendiente).
- El **system prompt** (en `CoachConversation.js`) pide respuestas CONCISAS y
  directas (se lee entre series), mantenerse EN TEMA (básquet/entrenamiento/
  nutrición deportiva/plan; redirige lo off-topic) y **no inventar cargas sin
  calibrar** (coherencia con la calibración).
- `generationConfig.temperature` = `config.ai.temperature` (default 0.6,
  `AI_TEMPERATURE`) para respuestas consistentes.
- **Deuda**: el historial se reenvía COMPLETO en cada mensaje (sin ventana) →
  crece en costo/tokens en conversaciones largas.

## Comandos

```bash
npm run dev        # nodemon, escucha en 0.0.0.0:4000, API bajo /api/v1
npm test           # Jest (integración + unit)
```

Seed idempotente (directo a la DB vía Mongoose; ver "Base de datos" abajo):

```powershell
$env:SEED_ADMIN_PASSWORD="..."; $env:SEED_DEMO_PASSWORD="..."; node scripts/seed.js --dry-run
$env:SEED_ADMIN_PASSWORD="..."; $env:SEED_DEMO_PASSWORD="..."; node scripts/seed.js
```

Crea admin + demo (con perfiles), 5 ejercicios + 5 rutinas + el plan semanal
de 7 días, y activa el plan al demo.

## Base de datos: validadores, índices y reconstrucción

**Fuente de verdad de los validadores de Atlas: `db/validators/<coleccion>.json`**
(uno por colección, con el nombre REAL de la colección). Se aplican A MANO en
Compass (Validation → strict / error). Nunca desde código.

- Se GENERAN desde los schemas de Mongoose: `node scripts/generate-validators.js`
  (offline, no necesita .env). Estilo: `additionalProperties: false`, numéricos
  `"number"`, no requeridos `[tipo, "null"]`, timestamps/`__v` declarados si el
  schema los escribe (`__v` solo en la raíz; hoy todos tienen `versionKey: false`).
- Tras cambiar un schema: regenerar, revisar el diff en git y aplicar el nuevo
  validador en Compass ANTES de desplegar.
- Guardas en tests: `tests/db.setup.js` aplica estos validadores (strict) a la DB
  en memoria → toda la suite falla si un write los viola; y
  `atlasValidators.test.js` corre `--check` (falla si los archivos se
  desincronizan de los schemas).
- Índices: los crea Mongoose al arrancar (`autoIndex`/`autoCreate` en default
  `true`). EXCEPCIÓN: el único parcial de plan activo NO está en el schema y se
  crea a mano (ver abajo).

**Seed idempotente**: `scripts/seed.js` + catálogo en `db/seed/catalog.js`
(clave natural: ejercicio `name`, rutina `title`, plan `name`). Crea el admin
`mateo@test.com` (con perfil), el demo `workout.demo@test.com` (perfil + plan 1 activo) y el
catálogo. Contraseñas SOLO por env (`SEED_ADMIN_PASSWORD`, `SEED_DEMO_PASSWORD`);
si el usuario ya existe no se toca su contraseña. `--dry-run` no escribe.
Las URLs de video (Cloudinary) se pegan en `db/seed/catalog.js`; sin URL el
ejercicio queda sin video (placeholder en la app).

**Reconstrucción desde cero** (si el cluster se pierde):
1. Compass: crear las colecciones de `db/validators/` en la DB de `DB_NAME`
   (default `grysto_db`), cada una con su validador (strict / error).
2. `npm run dev` una vez → Mongoose crea los índices. Verificar en Compass.
3. Índice único parcial (a mano):
   `db.userPlans.createIndex({ userId: 1 }, { unique: true, partialFilterExpression: { status: "active" }, name: "uniq_active_plan_per_user" })`
4. `node scripts/seed.js --dry-run` → `node scripts/seed.js` (con las env de
   contraseña). Correrlo de nuevo debe decir `0 creados, 0 actualizados`.

## Deploy pendiente (producción)

Render con el blueprint `render.yaml` (servicio `grysto-api`, base
`grysto_prod` en el mismo cluster). Guía paso a paso fuera del repo:
`C:\proyectos\DEPLOY_RENDER.md`. **`autoDeploy`: cada push a `main` despliega**,
así que `main` tiene que estar siempre desplegable. La región de
`render.yaml` está como `REGION_PENDIENTE` hasta elegirla.

Variables que hay que configurar en producción antes de publicar la auth por
código:

- **`AUTH_CODE_SECRET` propia** (larga, aleatoria). Sin ella se deriva de
  `JWT_REFRESH_SECRET`, que es solo un fallback de desarrollo.
- **`EMAIL_FROM` con el dominio definitivo de Grysto** (hoy en desarrollo se
  usa un dominio provisorio).
- **`RESEND_API_KEY` de la cuenta de Resend donde esté verificado ese
  dominio**. Si la key es de otra cuenta, Resend rechaza el envío.

Con `NODE_ENV=production`, `config/env.js` (`loadConfig`) **no arranca** si
falta alguna de `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `AUTH_CODE_SECRET`,
`RESEND_API_KEY`, `EMAIL_FROM`, `MONGODB_URI`, `DB_NAME` o `GEMINI_API_KEY`.
También corta si un secreto tiene menos de 32 caracteres o se repite, y en
todos los casos informa todos los problemas juntos, sin valores.

Otras piezas de producción:

- **`trust proxy`**: `TRUST_PROXY` vale 1 por defecto en producción (el proxy
  de Render) y está desactivado en desarrollo. `true` se rechaza porque dejaría
  falsear la IP y esquivar los rate limits.
- **`GET /health`** (alias `/api/v1/health`): no consulta la base, solo lee el
  `readyState`. Devuelve 200 si está conectado y 503 si no. Va antes del access
  log.
- **Coach**: timeout `AI_TIMEOUT_MS` (20 s por defecto) → 504 `AI_TIMEOUT`.
- **Logs**: el access log registra método, ruta sin query, status y ms, y
  ninguno de los logs muestra body, headers, IP ni usuario. Los emails salen
  enmascarados (`utils/redact.maskEmail`). Hay un test que verifica que no
  aparecen contraseñas, tokens ni códigos.
- **Refresh tokens**: siempre hasheados (SHA-256). El validador de
  `refreshtokens` exige `pattern: ^[0-9a-f]{64}$`; el generador traduce la
  opción `pattern` de un SchemaType.
- **Seed**: `node scripts/seed.js --prod` solo corre contra `grysto_prod` y
  crea únicamente el catálogo y el admin `grystoworkouts@gmail.com`, nunca el
  demo. Sin `--prod`, se niega a tocar `grysto_prod`. En `--prod` no crea
  colecciones ni índices (`autoCreate`/`autoIndex` en false) y aborta si falta
  alguna colección: deben existir antes, creadas con su validador. En una base
  vacía, que Mongoose cree colecciones e índices mientras el seed escribe
  dejaba el insert colgado.

**Antes de pushear a `main`:** `npm test` y `node scripts/generate-validators.js --check`.

## Reglas de trabajo

- **NUNCA leer ni imprimir `.env`.** Secretos solo ahí.
- Los validators JSON Schema de **Atlas se aplican MANUALMENTE en Compass**
  (modo Strict). Si cambias un schema de Mongoose, el validator de Atlas NO
  se actualiza solo: hay que avisar y actualizar a mano, o las escrituras
  fallarán con Document failed validation.
- Commits en español, ramas `feat/*` — no commitear directo en `main`.

## Deuda conocida (no repetir, no ignorar)

1. ~~**Bug de cargas iniciales**~~ **RESUELTO** (calibración sobre la marcha):
   `baseValueFromEntry` fue eliminado. Las cargas ya no derivan de reps/sets;
   nacen sin calibrar (`suggestedValue: null`, `calibrated: false`) y se
   calibran con la marca real del usuario en la primera `confirm-load`. Ver
   "CALIBRACIÓN SOBRE LA MARCHA" arriba. **Requiere** el validator de Atlas de
   `userPlans` actualizado (suggestedValue nullable + campo `calibrated`).
2. **Progresión lineal infinita**: sin tope, sin deload, sin regla de fallo.
   +5 %/semana de precisión supera el 100 %.
3. **Modelos sin usar**: `WorkoutHistory` (crítico: confirm-day/confirm-load
   no escriben historial → no hay serie temporal de progreso), `GymInfo`,
   `Subscription`. `daysProgress.skipped` y `PLAN_STATUS.PAUSED` no tienen
   endpoint que los use.
4. **`category` del día es string libre** en el schema y el validator de
   weeklyPlan — debería validarse contra un enum en Zod (el frontend mapea
   imágenes/íconos por convención sobre EXERCISE_CATEGORIES + 'descanso').
