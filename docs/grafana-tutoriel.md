# Grafana — guide pratique TaskFlow

Tutoriel complet pour le cours Télémétrie & Analytique. À garder ouvert pendant le TP3 et au-delà.

---

## 1. Ce qu'est Grafana (et ce qu'il n'est pas)

**Grafana est une couche de visualisation**, pas une base de données. Il ne stocke pas vos métriques. Il se branche sur vos sources de données et leur pose des questions à l'affichage des panneaux.

| Grafana fait | Grafana NE fait PAS |
|---|---|
| Brancher 30+ types de sources (Prometheus, Postgres, Loki, ES, InfluxDB, MySQL, BigQuery, Tempo, Jaeger, CloudWatch...) | Stocker des métriques |
| Dashboards composables, panels arrangeables | Faire de l'ETL ou des pipelines |
| Alertes unifiées multi-sources | Remplacer un outil de BI métier (Metabase, Looker, Tableau) |
| Visualiser : time series, gauge, table, heatmap, bar, pie, logs, traces, géomap | Faire des reports paginés ou de l'OLAP cube |

**Positionnement** : on l'utilise massivement en **observability tech** (équipes SRE, plateforme, ops). Pour l'**analytique produit/métier**, les PM préfèrent Metabase ou Looker — Grafana est trop "ops" visuellement pour eux.

**Modèle de licence** : Grafana OSS (AGPLv3), gratuit et auto-hébergé — c'est ce qu'on utilise. Versions Enterprise et Cloud existent avec des features supplémentaires (LDAP, audit, datasource Splunk...).

---

## 2. Premier login

Sur TaskFlow : `http://localhost:3001`. Identifiants `admin / admin`.

Au premier login, Grafana propose de changer le mot de passe. Pour le cours, vous pouvez skip.

> **Tip** : si vous avez perdu la session ou voulez vérifier que la datasource est bien provisionnée, allez dans **Connections → Data sources**. Vous devriez voir `Prometheus` (par défaut) et `Postgres-TaskFlow`. Si l'un manque, Grafana n'a pas relu le provisioning → `docker compose restart grafana`.

---

## 3. Datasources

Une **datasource** est une connexion configurée vers une source de données. Chaque panneau dans Grafana s'attache à une datasource.

### 3.1 Provisioning vs UI

**Via l'UI** : Connections → Data sources → Add data source. Pratique pour explorer, mais perdu si on rebuild le conteneur.

**Via provisioning** : un fichier YAML dans `/etc/grafana/provisioning/datasources/`. Déclaratif, versionnable Git, idempotent. **C'est ce qu'on fait dans TaskFlow** :

```yaml
# grafana/provisioning/datasources/prometheus.yml
apiVersion: 1
datasources:
  - name: Prometheus
    uid: prometheus          # IMPORTANT : sinon Grafana génère un UID random
    type: prometheus
    url: http://prometheus:9090
    isDefault: true
```

L'UID explicite est crucial si vous référencez la datasource depuis un dashboard JSON provisionné, comme nous le faisons pour le dashboard Golden Signals.

### 3.2 Tester une datasource

Connections → Data sources → cliquer la datasource → **Save & test** en bas. Renvoie un message "Data source is working" ou une erreur claire.

### 3.3 Explorer une datasource sans dashboard

L'onglet **Explore** (boussole dans la barre gauche) permet de jouer avec une datasource sans créer de panel. Très pratique pour itérer sur une query avant de la coller dans un dashboard.

---

## 4. PromQL — les patterns essentiels

PromQL est le langage de requête de Prometheus. Sans lui, pas de dashboard observability sérieux.

### 4.1 Vecteur instantané vs vecteur range

```promql
http_requests_total                          # vecteur instantané : 1 valeur par série, à l'instant t
http_requests_total[5m]                      # vecteur range : toutes les valeurs des 5 dernières minutes
```

Les fonctions comme `rate()` consomment un range et renvoient un instant. On ne peut donc PAS afficher un range tel quel — il faut le transformer.

### 4.2 Sélecteurs de labels

```promql
http_requests_total{method="GET"}                       # égalité
http_requests_total{status=~"5.."}                      # regex (5xx)
http_requests_total{method="POST", route!="/health"}    # combiné
```

### 4.3 Les 8 fonctions à connaître par cœur

| Fonction | Usage | Exemple |
|---|---|---|
| `rate(metric[5m])` | Taux par seconde sur un Counter | `rate(http_requests_total[5m])` |
| `irate(metric[5m])` | Taux instantané (sur les 2 derniers samples). Volatile. | rarement utilisé |
| `increase(metric[1h])` | Combien d'incréments sur la fenêtre | `increase(errors_total[24h])` |
| `histogram_quantile(0.95, expr)` | Percentile depuis un Histogram | (voir 4.5) |
| `sum() by (label)` | Agrégation conservant un label | `sum by (route) (rate(...))` |
| `topk(N, expr)` | Top N par valeur | `topk(5, rate(http_requests_total[5m]))` |
| `delta(gauge[1h])` | Différence entre les bornes (pour gauges) | `delta(queue_size[10m])` |
| `absent(metric)` | 1 si la métrique n'existe pas (alerte "service mort") | `absent(up{job="api"})` |

### 4.4 Agrégations sans / avec labels

```promql
sum(rate(http_requests_total[5m]))                            # total tous services confondus
sum by (route) (rate(http_requests_total[5m]))                # par route
sum without (instance) (rate(http_requests_total[5m]))        # par tout SAUF instance
```

### 4.5 Percentiles depuis un Histogram

C'est LE pattern à retenir pour les latences :

```promql
histogram_quantile(0.95,
  sum by (le) (
    rate(http_request_duration_seconds_bucket[5m])
  )
)
```

**Pourquoi le `sum by (le)` à l'intérieur ?** L'histogram expose une métrique `_bucket` avec un label `le` (less-equal). Pour calculer un quantile global (toutes routes, tous status confondus), on doit agréger en GARDANT le label `le`. Si on oublie ce `sum by (le)`, le résultat est inutilisable.

Variante par route :
```promql
histogram_quantile(0.95,
  sum by (le, route) (
    rate(http_request_duration_seconds_bucket[5m])
  )
)
```

### 4.6 Opérations vectorielles

```promql
# Taux d'erreur
sum(rate(http_requests_total{status=~"5.."}[5m]))
/
sum(rate(http_requests_total[5m]))

# Pourcentage de saturation CPU
process_cpu_seconds_total / on (instance) process_cpu_quota
```

L'opérateur `on (label)` ou `ignoring (label)` règle le matching quand les labels diffèrent entre les deux vecteurs.

---

## 5. Anatomie d'un panel

Un panel = une visualisation + une ou plusieurs queries + des options de présentation.

### 5.1 Les onglets de l'éditeur de panel

Ouvrir un panel → bouton **Edit**. Vous arrivez sur l'éditeur avec, à droite, plusieurs onglets :

| Onglet | Rôle |
|---|---|
| **Query** | Vos requêtes (1 à N). Choix de la datasource. |
| **Transform** | Transformations post-query (sans toucher à la source). Voir 5.4. |
| **Alert** | Définition d'alertes liées à ce panel. Voir section 8. |
| **Panel options** | Title, description, repeat... |
| **Visualization** | Type de viz (time series, stat, gauge...) avec ses options spécifiques. |
| **Standard options** | Unit (seconds, bytes, percent...), decimals, min/max, color. |
| **Thresholds** | Seuils colorés (vert/jaune/rouge). |
| **Value mappings** | Remplacer une valeur par un texte (0 → "OK", 1 → "Critical"). |
| **Data links** | Cliquer une valeur → ouvrir une autre dashboard ou un URL externe. |
| **Field overrides** | Surcharger les options pour une série spécifique. |

### 5.2 Types de visualisations utiles

| Type | Quand l'utiliser |
|---|---|
| **Time series** | 90 % des cas. Lignes ou aires dans le temps. |
| **Stat** | Une grosse valeur. Bon pour RPS instantané, taux d'erreur global. |
| **Gauge** | Quand il y a un seuil clair (CPU 0-100 %). |
| **Bar gauge** | Liste de valeurs avec mini-jauges (top routes par latence). |
| **Table** | Tableau classique. Format Time = ranges, ou Table = instant. |
| **Bar chart** | Comparaison de valeurs discrètes (pas le temps). |
| **Heatmap** | Distribution dans le temps. Excellent pour visualiser des histograms. |
| **Logs** | Quand la datasource est Loki ou ES. Vue chronologique des logs. |
| **Geomap** | Couche carte (visites par pays). |
| **Pie chart** | À éviter en général — l'œil compare mal des arcs. |

### 5.3 Standard options à toujours configurer

- **Unit** : la barre la plus importante. Le défaut est "Number" qui n'a aucun sens pour une latence. Cherchez `seconds (s)`, `bytes (IEC)`, `percent (0.0-1.0)`, `req/s`...
- **Decimals** : 0 pour des compteurs, 1-3 pour des percentages, "auto" la plupart du temps.
- **No value** : que faire quand la query renvoie rien ? Par défaut "No data" — vous pouvez forcer à 0 pour les visualisations de comptage.

### 5.4 Transformations

Très utile quand vous voulez croiser plusieurs queries ou retravailler une réponse :
- **Reduce** : transforme une série temporelle en valeur unique (last, max, mean).
- **Join by field** : merge deux queries sur un label.
- **Organize fields** : renommer/réordonner les colonnes pour les tables.
- **Filter data by values** : ne garder que les lignes au-dessus d'un seuil.
- **Rename by regex** : renommer les séries automatiquement.

Bonnes pratiques : préférer **calculer côté PromQL** plutôt que transformer côté Grafana quand c'est possible (plus performant et lisible).

---

## 6. Construire un dashboard

### 6.1 Création

**New dashboard** (top right) → **Add visualization** → choisir une datasource.

### 6.2 Layout

- Drag pour déplacer un panel.
- Coin bas-droit pour redimensionner.
- Snap automatique sur une grille 24 colonnes.
- **Row** : groupe collapsible de panels (clic droit sur le canevas → Add a row).

### 6.3 Variables (template variables)

Permettent de rendre un dashboard interactif (sélecteur en haut). Très utile pour des dashboards multi-environnements ou multi-services.

**Dashboard settings (engrenage en haut)** → **Variables** → **Add variable**.

Types courants :
- **Query** : récupère les valeurs depuis une datasource. Exemple PromQL : `label_values(http_requests_total, route)` → liste toutes les routes.
- **Custom** : valeurs en dur.
- **Interval** : périodes (`1m, 5m, 1h`) utilisables comme `$interval` dans les queries.
- **Datasource** : pour basculer entre datasources.

Utilisation dans une query : `rate(http_requests_total{route="$route"}[5m])`.

**Options utiles** : "Multi-value" + "Include All option" pour pouvoir sélectionner plusieurs valeurs ou "Tout".

### 6.4 Time range et refresh

En haut à droite :
- **Sélecteur de période** : raccourcis (Last 5 min, Last 24h) ou plage personnalisée. Préférer les raccourcis relatifs pour des dashboards qui doivent rester pertinents demain.
- **Auto-refresh** : 5s, 10s, 30s, 1m... Attention au coût pour les datasources (chaque refresh = re-query).

### 6.5 Annotations

Marquent des événements verticaux sur tous les time series d'un dashboard. Très utile pour corréler un déploiement avec une dégradation de latence.

**Dashboard settings → Annotations → Add annotation query**. Souvent depuis une métrique Prometheus type `version` ou via une API maison.

### 6.6 Repeating panels

Très puissant : un panel se duplique automatiquement pour chaque valeur d'une variable.

Sur un panel : **Panel options → Repeat options → Repeat by variable**. Exemple : un panel "Latency p99" qui se répète pour chaque `$service`. En 30 secondes vous avez un dashboard multi-services.

### 6.7 Exporter / partager

- **Share dashboard** → **Export** : JSON téléchargeable pour versionner Git.
- **Share dashboard** → **Snapshot** : URL publique d'une capture statique (sans datasource).

Pour TaskFlow, le dashboard "Golden Signals" est versionné dans `grafana/dashboards/golden-signals.json` et provisionné automatiquement au démarrage de Grafana.

---

## 7. Provisioning complet (datasources + dashboards + alerts)

Pour rendre vos dashboards reproductibles et infrastructure-as-code :

```
grafana/
├── provisioning/
│   ├── datasources/
│   │   └── prometheus.yml      # datasources déclaratives
│   ├── dashboards/
│   │   └── dashboards.yml      # config du provider de dashboards
│   └── alerting/
│       └── alerts.yml          # alertes Grafana managed
└── dashboards/
    └── golden-signals.json     # dashboards exportés en JSON
```

**Le piège récurrent** : si vous modifiez un dashboard provisionné dans l'UI Grafana, les modifs sont **éphémères** — au prochain restart, Grafana réimporte le JSON de référence. Solution :
- soit modifier le JSON et faire `docker compose restart grafana`
- soit utiliser **Save as** pour créer une copie modifiable

---

## 8. Alerting

Grafana propose deux mondes pour les alertes :
- **Grafana managed alerts** : géré entièrement par Grafana (notre choix par défaut)
- **Data source managed** : alertes Prometheus AlertManager, Loki Ruler, etc.

### 8.1 Créer une alerte depuis un panel

Sur un panel → onglet **Alert** → **Create alert rule from this panel**.

Une alerte se compose de :

1. **Query and alert condition** : une ou plusieurs queries, puis une expression qui les combine en `Threshold`, `Math`, ou `Reduce`.
2. **Set folder and group** : organisation des alertes par dossier.
3. **Alert evaluation** : à quelle fréquence évaluer (souvent 30s ou 1m), et combien de temps la condition doit être vraie avant de "firer" (`for: 1m` typiquement, pour éviter les flappings sur des spikes courts).
4. **Notifications** : labels qui détermineront le routage.

### 8.2 États d'une alerte

| État | Signification |
|---|---|
| **Normal** | Condition OK |
| **Pending** | Condition violée mais pas depuis assez longtemps (durée `for:`) |
| **Firing** | Condition violée depuis assez longtemps → notif envoyée |
| **NoData** | La query renvoie pas de données — souvent signe d'un service mort |
| **Error** | Erreur d'évaluation (datasource down, syntaxe...) |

### 8.3 Contact points

Où envoyer les notifications. Dans **Alerting → Contact points** :
- Email
- Slack (webhook)
- PagerDuty
- Discord
- Teams
- Webhook custom
- Telegram

Pour le cours, pas besoin de configurer — on vérifie juste que l'alerte passe en `Firing` dans la liste.

### 8.4 Notification policies

Routage des alertes selon leurs labels. Par exemple :
- `severity=critical` → PagerDuty + Slack #incidents
- `team=frontend` → Slack #frontend
- Tout le reste → Email équipe

Structure en arbre : on définit un default puis on greffe des routes spécifiques.

### 8.5 Silences

Mettre une alerte en sourdine pendant une maintenance, par exemple. **Alerting → Silences → New silence** avec une regex sur les labels et une période.

### 8.6 Bonnes pratiques alerting

- **Actionnable** : si on ne peut rien faire en recevant l'alerte, ne pas la créer
- **Pas de flapping** : `for: 1m` minimum pour les alertes infrastructure, `5m` ou plus pour les alertes métier
- **Runbook** : chaque alerte doit pointer vers une procédure documentée (annotation `runbook_url`)
- **Severity claire** : `critical` (PagerDuty 24/7), `warning` (Slack), `info` (juste pour info)
- **Test régulier** : si une alerte n'a jamais firé, comment savoir qu'elle marche ? Faire des chaos drills.

---

## 9. Pièges récurrents et comment les éviter

### 9.1 Oublier `rate()` sur un Counter

Si vous tracez directement `http_requests_total`, vous voyez une courbe qui monte toujours. Inutilisable. **Toujours** envelopper d'un `rate()` ou `increase()`.

### 9.2 Cardinality explosion

Chaque combinaison unique de labels crée une nouvelle "série" stockée par Prometheus. Si vous mettez `user_id` en label avec 1M d'utilisateurs : 1M de séries. Prometheus s'effondre.

**Règle** : labels = dimensions analytiques **discrètes** (method, status, route, environment). Jamais un identifiant unique.

### 9.3 `req.path` vs `req.route?.path`

Si dans votre middleware Express vous utilisez `req.path` comme label, vous aurez :
- `/api/tasks/42`
- `/api/tasks/43`
- `/api/tasks/44`
- ... à l'infini

Avec `req.route?.path`, vous obtenez `/api/tasks/:id` → une seule série. Vu au TP2.

### 9.4 `histogram_quantile` sans `sum by (le)`

Renvoie n'importe quoi. Toujours :
```promql
histogram_quantile(0.95, sum by (le) (rate(metric_bucket[5m])))
```

### 9.5 Step interval et trous dans les graphes

Quand vous zoomez sur 7 jours, Grafana sample à un step très large (genre 5m). Si votre `rate()` utilise `[5m]`, vous risquez d'avoir des fenêtres vides → trous.

**Règle pro** : `rate(metric[$__rate_interval])`. La variable `$__rate_interval` s'adapte automatiquement.

### 9.6 Mélanger Counter et Gauge

`rate(memory_usage_bytes[5m])` n'a aucun sens — la mémoire n'est pas cumulative. `delta()` est plus adapté pour une gauge, ou simplement la métrique brute.

### 9.7 Datasource UID non explicite

Si vous provisionnez une datasource sans UID forcé, Grafana en génère un aléatoire. Vos dashboards JSON qui référencent `"uid": "prometheus"` ne trouveront rien. **Toujours définir un UID** dans le YAML de provisioning.

---

## 10. Cheat sheet à imprimer

```
# Patterns PromQL qui couvrent 90 % des cas

# Taux par seconde
sum(rate(metric[5m]))

# Top N par dimension
topk(5, sum by (route) (rate(http_requests_total[5m])))

# p99 latence
histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))

# Taux d'erreur (ratio)
sum(rate(http_requests_total{status=~"5.."}[5m]))
/
sum(rate(http_requests_total[5m]))

# Service mort (alerte)
absent(up{job="taskflow-api"})

# Différence sur 24h
increase(events_received_total[24h])
```

```
# Raccourcis clavier Grafana

t a              # Zoom out
?                # Liste des raccourcis
d r              # Recharger toutes les queries
d s              # Save dashboard
e                # Éditer le panel sous le curseur
v                # View panel (plein écran)
p                # Panel actions menu
```

```
# Units à utiliser systématiquement

s        # seconds
ms       # millisecondes
bytes    # bytes (IEC)
percentunit   # 0.0-1.0
percent       # 0-100
reqps    # req/s (à taper "req/s" dans le champ)
short    # nombres avec K/M/G
```

---

## 11. Pour aller plus loin

- **Documentation officielle** : [grafana.com/docs/grafana/latest/](https://grafana.com/docs/grafana/latest/)
- **Dashboard library** : [grafana.com/grafana/dashboards/](https://grafana.com/grafana/dashboards/) — milliers de dashboards prêts à importer (Node.js exporter, Kubernetes, Postgres...)
- **PromQL playground** : [demo.do.prometheus.io](https://demo.do.prometheus.io)
- **Anti-pattern: USE method vs RED method** — les deux philosophies d'observabilité à comparer
- **Tempo** (traces) et **Loki** (logs) : les autres briques de la stack Grafana Labs
