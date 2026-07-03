<#
  seed-test-plan.ps1 — Crea datos de prueba para ver el HOME con datos reales.

  Encadena, vía la API REST:
    1. Login admin
    2. Crea 5 ejercicios (categorías variadas)
    3. Crea 5 rutinas (cada una con un ejercicio)
    4. Crea un WeeklyPlan de 7 días variados (con 2 días de descanso)
    5. Login del usuario de la app y ACTIVA el plan para él

  Uso (PowerShell, con el backend corriendo en :4000):
    ./scripts/seed-test-plan.ps1 `
        -AdminEmail "admin@grysto.com" -AdminPass "TuPassAdmin" `
        -UserEmail "sigotsena@gmail.com" -UserPass "TuPassDeLaApp"

  Requisitos: un usuario ADMIN ya existente y verificado, y el usuario de la
  app (el que usas en el celular) ya registrado y verificado.
#>

param(
  [string]$BaseUrl   = "http://localhost:4000/api/v1",
  [Parameter(Mandatory = $true)][string]$AdminEmail,
  [Parameter(Mandatory = $true)][string]$AdminPass,
  [Parameter(Mandatory = $true)][string]$UserEmail,
  [Parameter(Mandatory = $true)][string]$UserPass
)

$ErrorActionPreference = "Stop"

function Login($email, $pass) {
  $body = @{ email = $email; password = $pass } | ConvertTo-Json
  $res = Invoke-RestMethod -Uri "$BaseUrl/auth/login" -Method Post -ContentType "application/json" -Body $body
  return $res.data.accessToken
}

function Post($token, $path, $obj) {
  $body = $obj | ConvertTo-Json -Depth 10
  $headers = @{ Authorization = "Bearer $token" }
  return Invoke-RestMethod -Uri "$BaseUrl$path" -Method Post -ContentType "application/json" -Headers $headers -Body $body
}

Write-Host "→ Login admin..." -ForegroundColor Cyan
$admin = Login $AdminEmail $AdminPass

# ── 1. Ejercicios ───────────────────────────────────────────────────────────
Write-Host "→ Creando ejercicios..." -ForegroundColor Cyan
$video = @{ type = "youtube"; youtubeUrl = "https://youtube.com/watch?v=dQw4w9WgXcQ" }

$exDefs = @(
  @{ name = "Sentadilla con barra"; category = "fuerza";       desc = "Sentadilla profunda para tren inferior y potencia de salto." },
  @{ name = "Crossover entre conos"; category = "dribbling";   desc = "Cambio de mano explosivo entre conos para manejo de balon." },
  @{ name = "Salto al cajon";        category = "salto";       desc = "Salto pliometrico al cajon para desarrollar el salto vertical." },
  @{ name = "Tiro libre con arco";   category = "tiro";        desc = "Repeticiones de tiro libre cuidando la mecanica y el arco." },
  @{ name = "Sprint de cancha";      category = "resistencia"; desc = "Sprints de extremo a extremo para acondicionamiento fisico." }
)

$exIds = @{}
foreach ($e in $exDefs) {
  $payload = @{
    name = $e.name; description = $e.desc; category = $e.category
    difficulty = "intermedio"; demoVideo = $video
  }
  $r = Post $admin "/exercises" $payload
  $exIds[$e.category] = $r.data.exercise._id
  Write-Host "   ✓ $($e.name) [$($e.category)] → $($r.data.exercise._id)"
}

# ── 2. Rutinas ──────────────────────────────────────────────────────────────
Write-Host "→ Creando rutinas..." -ForegroundColor Cyan
function Routine($title, $cat, $dur, $exId, $sets, $reps) {
  return Post $admin "/routines" @{
    title = $title
    description = "$title — rutina de prueba generada por el seed."
    level = "intermedio"; category = $cat; duration_min = $dur
    exercises = @(@{ exerciseId = $exId; order = 1; sets = $sets; reps = $reps; restSeconds = 60 })
  }
}

$r1 = Routine "Fuerza tren inferior" "gym"    45 $exIds["fuerza"]      4 "8"
$r2 = Routine "Manejo de balon"      "cancha" 30 $exIds["dribbling"]   3 "10"
$r3 = Routine "Pliometria y salto"   "fisico" 40 $exIds["salto"]       4 "6"
$r4 = Routine "Mecanica de tiro"     "cancha" 35 $exIds["tiro"]        5 "10"
$r5 = Routine "Acondicionamiento"    "fisico" 25 $exIds["resistencia"] 3 "12"

$R1 = $r1.data.routine._id; $R2 = $r2.data.routine._id; $R3 = $r3.data.routine._id
$R4 = $r4.data.routine._id; $R5 = $r5.data.routine._id
Write-Host "   ✓ 5 rutinas creadas"

# ── 3. WeeklyPlan (7 días variados, 2 de descanso) ──────────────────────────
Write-Host "→ Creando weekly plan..." -ForegroundColor Cyan
$plan = Post $admin "/weekly-plans" @{
  name = "Plan de prueba GRYSTO"
  description = "Plan semanal de prueba con dias variados para ver el home."
  targetPosition = @("all"); targetLevel = @("intermedio"); targetGoal = @("salto_vertical")
  isPremium = $false
  days = @(
    @{ dayNumber = 1; category = "fuerza";      title = "Fuerza explosiva";     isRestDay = $false; routines = @($R1) },
    @{ dayNumber = 2; category = "dribbling";   title = "Control de balon";     isRestDay = $false; routines = @($R2) },
    @{ dayNumber = 3; category = "salto";       title = "Salto vertical";       isRestDay = $false; routines = @($R3) },
    @{ dayNumber = 4; category = "descanso";    title = "Descanso activo";      isRestDay = $true;  routines = @() },
    @{ dayNumber = 5; category = "tiro";        title = "Tiro y mecanica";      isRestDay = $false; routines = @($R4) },
    @{ dayNumber = 6; category = "resistencia"; title = "Acondicionamiento";    isRestDay = $false; routines = @($R5) },
    @{ dayNumber = 7; category = "descanso";    title = "Descanso total";       isRestDay = $true;  routines = @() }
  )
}
$planId = $plan.data.weeklyPlan._id
Write-Host "   ✓ WeeklyPlan creado → $planId"

# ── 4. Activar el plan para el usuario de la app ────────────────────────────
Write-Host "→ Login usuario de la app y activando el plan..." -ForegroundColor Cyan
$user = Login $UserEmail $UserPass
$act = Post $user "/my-plan/activate" @{ weeklyPlanId = $planId }
Write-Host "   ✓ Plan activado para $UserEmail (UserPlan $($act.data.plan._id))" -ForegroundColor Green

Write-Host ""
Write-Host "Listo. Abre la app (o recarga el Home) y deberias ver el plan." -ForegroundColor Green
