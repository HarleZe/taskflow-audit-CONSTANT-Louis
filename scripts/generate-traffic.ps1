# generate-traffic.ps1 — Génère du trafic varié sur l'API TaskFlow
# Usage : .\scripts\generate-traffic.ps1
# Ctrl+C pour arrêter
#
# Génère :
# - Des GET et POST réussis (200/201/204)
# - Des 404 (route inexistante)
# - Des requêtes lentes (/api/slow → 1.5s)
# - Un faible taux de 500 (5%) pour faire bouger l'alerte taux d'erreur

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

$apiBase = "http://localhost:3000"
$counters = @{ ok = 0; err = 0; slow = 0; missing = 0 }
$start = Get-Date

Write-Host "🚀 Trafic en cours sur $apiBase ... Ctrl+C pour arrêter" -ForegroundColor Cyan
Write-Host ""

# Pool de titres aléatoires
$titres = @(
  "Préparer la démo", "Relire le slide 35", "Vérifier les TP",
  "Acheter du café", "Tester Grafana", "Refresh Metabase",
  "Lire pino docs", "Debug le span manuel"
)

while ($true) {
  # GET list tasks (très fréquent)
  try {
    Invoke-WebRequest -Uri "$apiBase/api/tasks" -UseBasicParsing | Out-Null
    $counters.ok++
  } catch { $counters.err++ }

  # GET health
  try {
    Invoke-WebRequest -Uri "$apiBase/health" -UseBasicParsing | Out-Null
    $counters.ok++
  } catch { $counters.err++ }

  # POST create task (1 fois sur 3)
  if ((Get-Random -Maximum 3) -eq 0) {
    $titre = $titres | Get-Random
    $body = @{ title = "$titre $(Get-Random -Maximum 9999)" } | ConvertTo-Json -Compress
    try {
      Invoke-WebRequest -Uri "$apiBase/api/tasks" -Method POST `
        -ContentType "application/json" -Body $body -UseBasicParsing | Out-Null
      $counters.ok++
    } catch { $counters.err++ }
  }

  # GET /api/slow (1 fois sur 4) - en arrière-plan pour ne pas bloquer
  if ((Get-Random -Maximum 4) -eq 0) {
    Start-Job -ScriptBlock {
      param($url)
      try { Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 | Out-Null } catch {}
    } -ArgumentList "$apiBase/api/slow" | Out-Null
    $counters.slow++
  }

  # GET route inexistante (1 fois sur 5) -> 404
  if ((Get-Random -Maximum 5) -eq 0) {
    try {
      Invoke-WebRequest -Uri "$apiBase/api/route-qui-nexiste-pas" -UseBasicParsing | Out-Null
    } catch { $counters.missing++ }
  }

  # POST volontairement invalide (1 fois sur 10) -> 400
  if ((Get-Random -Maximum 10) -eq 0) {
    try {
      Invoke-WebRequest -Uri "$apiBase/api/tasks" -Method POST `
        -ContentType "application/json" -Body '{"title":""}' -UseBasicParsing | Out-Null
    } catch { }
  }

  # Affichage compteur en haut (toutes les 10 itérations)
  if ((($counters.ok + $counters.err) % 10) -eq 0) {
    $elapsed = (Get-Date) - $start
    $total = $counters.ok + $counters.err + $counters.slow + $counters.missing
    $rps = if ($elapsed.TotalSeconds -gt 0) { [math]::Round($total / $elapsed.TotalSeconds, 1) } else { 0 }
    Write-Host -NoNewline "`r OK:$($counters.ok) SLOW:$($counters.slow) 404:$($counters.missing) ERR:$($counters.err) RPS:${rps} TIME:$($elapsed.ToString('mm\:ss')) "
  }

  # Nettoyage périodique des jobs terminés
  if ((($counters.ok) % 30) -eq 0) {
    Get-Job -State Completed | Remove-Job -Force
  }

  Start-Sleep -Milliseconds 300
}
