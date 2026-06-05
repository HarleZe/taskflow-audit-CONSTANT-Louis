# Jaeger UI — guide pratique TaskFlow

Tutoriel d'utilisation de l'interface Jaeger pour explorer les traces distribuées du TP4.

---

## 1. Qu'est-ce que Jaeger ?

Jaeger est un système d'**observabilité distribuée** open source, créé par Uber en 2016, donné à la CNCF en 2017, graduated en 2019. Il gère deux briques :

- **Backend** : un service qui reçoit les traces depuis vos applications (via OTLP, gRPC ou HTTP), les stocke (mémoire, Cassandra, Elasticsearch...) et les indexe.
- **UI** : l'interface web qu'on explore dans ce tutoriel.

Sur TaskFlow, on utilise l'image `jaegertracing/all-in-one` qui combine ces deux briques en un seul conteneur, avec stockage en mémoire (perdu au restart — c'est OK pour le cours).

### Pourquoi Jaeger plutôt qu'autre chose ?

| Outil | Note |
|---|---|
| **Jaeger** | Open source, mature, simple à déployer, UI claire. Bon défaut. |
| **Grafana Tempo** | Stack Grafana cohérente, scale mieux pour les très gros volumes, UI intégrée à Grafana. |
| **Zipkin** | Encore plus ancien (Twitter, 2012), moins populaire aujourd'hui. |
| **Datadog APM / Honeycomb / Lightstep** | Commerciaux, plus puissants pour l'analyse, mais coûteux. |

---

## 2. Ouvrir Jaeger

Sur TaskFlow : `http://localhost:17686` (port host modifié à 17686 pour éviter les conflits Windows — le port interne du conteneur est 16686).

Vous arrivez sur la page **Search**.

---

## 3. Anatomie de la page Search

C'est ici qu'on cherche des traces parmi celles ingérées par Jaeger.

### 3.1 Service

Liste déroulante en haut à gauche. Pour TaskFlow, vous devriez voir `taskflow-api` apparaître **dès que** l'API a émis au moins une trace.

> Si la liste est vide après un démarrage : avez-vous bien lancé l'API avec `node --import ./tracing.mjs server.js` ? Avez-vous fait au moins une requête HTTP ?

### 3.2 Operation

Filtre par nom d'opération (= span racine). Pour une API HTTP, ce sont typiquement les routes :
- `GET /api/tasks`
- `POST /api/tasks`
- `POST /api/ingest`
- `GET /api/slow`
- `GET /metrics`

Choisir `all` pour ne pas filtrer.

### 3.3 Tags

Filtre puissant sur les attributs des spans. Syntaxe `clé=valeur`. Exemples :
- `http.status_code=500` → toutes les traces qui ont eu une erreur HTTP
- `http.method=POST` → uniquement les POST
- `error=true` → traces qui ont une erreur applicative
- Plusieurs tags séparés par espace : combiné en ET logique

> Tip : la liste exacte des tags disponibles dépend des bibliothèques instrumentées. Pour OpenTelemetry Node avec auto-instrumentation : `http.url`, `http.target`, `http.status_code`, `db.system`, `db.statement`...

### 3.4 Lookback

Période de recherche. Défaut : "Last Hour". Les options :
- Last Hour / 6 Hours / 12 Hours / 1 Day / 2 Days
- Custom Time Range

> **Piège habituel** : si vous cherchez sur "Last Hour" mais que votre dernière requête date d'il y a 2h, vous ne verrez rien. Étendez la période ou refaites des requêtes.

### 3.5 Min Duration / Max Duration

Filtrer les traces par durée. Très utile pour ne voir QUE les requêtes lentes :
- `Min Duration: 1s` → ne montre que les requêtes ≥ 1 seconde

### 3.6 Limit Results

Combien de traces afficher au maximum. Défaut 20. Pour les gros volumes, n'augmentez pas trop sinon le UI rame.

### 3.7 Le bouton "Find Traces"

Lance la recherche. Une liste apparaît en bas avec, pour chaque trace :
- Trace ID (8 caractères hex affichés)
- Service.operation (le span racine)
- Durée totale
- Timestamp
- Nombre de spans
- Mini-graphe horizontal qui montre où la durée a été dépensée

> **Astuce** : la liste est triable par durée (clic sur la colonne) — pratique pour traquer les outliers.

---

## 4. Lire une trace

Cliquez sur une trace dans la liste pour ouvrir sa vue détaillée.

### 4.1 La cascade de spans

C'est le cœur de Jaeger. Vous voyez :
- En haut, une **timeline horizontale** = durée totale de la trace
- En bas, chaque **span** sous forme de barre, positionnée selon son début et avec une largeur = sa durée
- L'indentation visuelle montre la **hiérarchie parent/enfant**

Exemple typique d'un `POST /api/tasks` instrumenté :

```
├── POST /api/tasks          [HTTP server span]         24ms
│   ├── middleware            [Express]                  2ms
│   ├── middleware            [Express]                  1ms
│   ├── request handler       [Express]                 21ms
│   │   └── pg.connect       [Postgres client]         18ms
│   │       └── INSERT       [SQL query]              17ms
```

### 4.2 Ce qu'on lit immédiatement

- **La durée totale** (en haut à droite) : 24ms ici
- **Le span le plus long** : visuellement la barre la plus large → la DB ici
- **Le ratio temps DB / temps app** : si DB ≫ app, c'est la DB qui freine

### 4.3 Cliquer sur un span pour voir ses détails

Le panneau qui s'ouvre montre :
- **Tags** : tous les attributs du span. Pour un span HTTP : `http.method`, `http.url`, `http.status_code`, `http.target`. Pour un span DB : `db.system`, `db.statement`, `db.connection_string`.
- **Logs** : événements horodatés rattachés au span. Souvent vide en auto-instrumentation, plus riche en spans manuels.
- **Process** : info sur le process qui a émis le span (service.name, host.name, version...).

### 4.4 Span manuel (vu en TP4)

Si vous avez ajouté un span manuel dans `/api/slow` :

```js
await tracer.startActiveSpan('fake-business-logic', async (span) => {
  span.setAttribute('reason', 'demo bottleneck');
  await new Promise(r => setTimeout(r, 1500));
  span.end();
});
```

Vous verrez dans la cascade un span `fake-business-logic` à l'intérieur du span HTTP, avec son attribut `reason` visible dans les tags.

---

## 5. Compare Traces

Onglet en haut à gauche. Permet de comparer **deux traces côte à côte** par leur ID.

Cas d'usage : "ma requête est lente depuis hier, qu'est-ce qui a changé ?" → comparer une trace d'hier et une trace d'aujourd'hui. Le diff visuel saute aux yeux.

---

## 6. System Architecture

Onglet en haut. Génère automatiquement un **graphe des services** à partir des traces récentes : qui appelle qui, combien de fois, avec quelle latence moyenne.

Sur TaskFlow (un seul service), c'est peu intéressant. En microservices complexes, c'est précieux pour repérer les dépendances et les hot-paths.

---

## 7. Cas d'usage typiques (à pratiquer dans TaskFlow)

### 7.1 "Pourquoi cette requête a-t-elle pris X secondes ?"

1. **Find Traces** avec `Min Duration: 1s`
2. Cliquer sur une trace lente
3. Repérer le span le plus large dans la cascade
4. Cliquer dessus → regarder ses tags pour comprendre ce qui s'est passé

### 7.2 "Où sont mes erreurs ?"

1. Tags : `http.status_code=500` ou `error=true`
2. Find Traces
3. Pour chaque trace en erreur, regarder le span qui a échoué (souvent un span avec un tag `error=true` quelque part)

### 7.3 "Quelle route est la plus lente en p99 ?"

Jaeger n'est pas l'outil idéal pour ça — il manipule des traces individuelles, pas des agrégats. Pour ça, **Grafana + Prometheus** est mieux (`histogram_quantile`). Mais une fois la route identifiée dans Grafana, vous venez dans Jaeger pour comprendre POURQUOI.

### 7.4 "Cette requête appelle-t-elle vraiment la DB ?"

Dans la cascade, chercher un span dont le nom commence par `pg`, `mysql`, `redis`, etc. Si absent, soit la DB n'est pas instrumentée (bug d'auto-instrumentation), soit la requête tape un cache et zappe la DB.

---

## 8. Tail Sampling (notion)

Par défaut, OTel SDK garde 100 % des traces — vous voyez tout. En prod avec des millions de requêtes par jour, ce serait insoutenable. On échantillonne :

- **Head sampling** : décision prise au début de la trace. Simple, statistique (1 %, 10 %, 100 %), mais on peut rater des erreurs par malchance.
- **Tail sampling** : décision après la fin de la trace. On garde TOUTES les traces avec erreurs ou latence > seuil, et 1 % des traces "normales". C'est le pattern pro.

Le tail sampling nécessite un **OpenTelemetry Collector** entre vos apps et Jaeger, configuré avec une politique de sampling. C'est hors scope du TP4, mais bon à connaître.

---

## 9. Limites de Jaeger

À savoir avant de l'imposer en prod :

- **Stockage volatile par défaut** : in-memory. En prod, brancher Cassandra ou Elasticsearch.
- **Pas de longue rétention** : Jaeger est conçu pour le debugging récent (heures, jours), pas pour de l'historique de mois.
- **Volume** : à plusieurs millions de traces/jour, le UI rame. Considérer Grafana Tempo ou un APM commercial.
- **Pas d'alerting natif** : Jaeger ne fait que stocker et afficher. Pour des alertes sur les traces lentes, dériver une métrique avec OTel Collector et alerter via Prometheus.

---

## 10. Cheat sheet rapide

```
URL TaskFlow            http://localhost:17686
Service                 taskflow-api (apparaît après 1ère trace)

Filtres tags utiles
  http.status_code=500     erreurs serveur
  http.method=POST         uniquement POST
  http.target=/api/tasks   uniquement cette route
  error=true               erreur applicative

Filtres durée
  Min Duration: 1s         requêtes lentes seulement
  Max Duration: 100ms      requêtes rapides seulement

Lookback
  Défaut "Last Hour" — pensez à élargir si vide

Raccourci debug typique
  1. Min Duration 1s
  2. Trier la liste par Duration desc
  3. Cliquer la pire trace
  4. Repérer le span le plus large
  5. Lire les tags
```
