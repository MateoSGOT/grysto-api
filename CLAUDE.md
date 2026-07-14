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

## Ejercicios: video de guía (`demoVideo`)

`Exercise.demoVideo = { type, cloudinaryUrl, youtubeUrl }`. `type` (enum
`VIDEO_TYPES`) es **`cloudinary`** (MP4 directo, reproductor propio en la app —
preferido) o **`youtube`** (legacy). El Zod exige la URL que corresponde al
`type` (`cloudinaryUrl` si cloudinary, `youtubeUrl` si youtube). El validator
de Atlas de `exercises` **ya permite `cloudinaryUrl`** (`["string","null"]`, no
en `required`), así que no hay que tocar Atlas para usar MP4.

## Auth

JWT access (corto) + refresh con **rotación en cada uso y detección de
reuso** (`RefreshToken` model): un refresh token reutilizado invalida la
familia completa ("sesión comprometida"). Verificación de email por token;
rate limits por endpoint en `middlewares/rateLimit.middleware.js` (el del
coach es por usuario: 20 msg / 15 min).

## Coach IA

Fachada agnóstica al proveedor (`services/ai/ai.service.js` + adapters en
`providers/`): Gemini (default, free tier) y Anthropic. Costos estimados por
mensaje (`constants/aiPricing.js`) persistidos en `CoachConversation`.
Contexto actual = system prompt + PlayerProfile + historial (aún NO incluye
el plan activo — ver deuda).

## Comandos

```bash
npm run dev        # nodemon, escucha en 0.0.0.0:4000, API bajo /api/v1
npm test           # Jest (integración + unit)
```

Seed de datos de prueba (backend corriendo; requiere admin y usuario
verificados):

```powershell
./scripts/seed-test-plan.ps1 -AdminEmail "..." -AdminPass "..." -UserEmail "..." -UserPass "..."
```

Crea 5 ejercicios + 5 rutinas + plan semanal de 7 días variados y lo activa.

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
