# Devoir maison — Audit & Analyse TaskFlow

**Cours** : Télémétrie & Analytique — M1 ESGI Reims
**Délai** : rendu pour **samedi 13 juin 2026, 23h59**

---

## Contexte

Le dossier `taskflow-buggy/` contient une version « production » de TaskFlow livrée par un développeur junior, accompagnée d'un dataset d'événements `data/events.csv` (1 mois d'usage).

Vous avez deux missions :

1. **Auditer le code et l'infrastructure** d'instrumentation pour identifier et corriger les bugs
2. **Analyser les données** d'usage pour produire des insights produit

Les deux parties touchent directement aux compétences du cours : instrumentation web, KPIs, esprit critique face aux données, RGPD.

---

## Lancement

```bash
cd taskflow-buggy
docker compose up -d

cd backend && npm install && npm run dev
# autre terminal
cd frontend && npm install && npm run dev
```

| Service | URL | Login |
|---|---|---|
| Frontend | http://localhost:5173 | — |
| Backend API | http://localhost:3000 | — |
| Prometheus | http://localhost:9090 | — |
| Grafana | http://localhost:3001 | admin / admin |
| Jaeger | http://localhost:17686 | — |
| Metabase | http://localhost:3002 | (à créer au premier lancement) |

Pour générer du trafic et observer le comportement :
```powershell
.\scripts\generate-traffic.ps1
```

---

## Partie 1 — Audit du code (12 pts)

Le repo contient **5 bugs liés à la télémétrie et à l'analytique** dans :

- `backend/server.js`
- `frontend/tracker.js`
- `grafana/dashboards/golden-signals.json`

Ces bugs sont des **anti-patterns réels** d'instrumentation web qui ne causent pas de crash visible : cardinality Prometheus, RGPD, requête PromQL bancale, etc. Identifiez-les, corrigez-les, et expliquez chaque modification dans le rapport.

Pour chaque bug : expliquez **dans quelles conditions il se manifeste** et **quel est l'impact concret**.

---

## Partie 2 — Analyse du dataset (8 pts)

Vous disposez de `data/events.csv` : ~14 800 événements simulés sur 1 mois, avec colonnes `event_name, user_id, session_id, occurred_at, cohort, device, country, duration_ms`.

Le funnel d'événements est :
`page_view → task_create_click → task_form_submit → task_toggle`

### 2.1 — Chargement (1 pt)

Chargez le CSV dans une table `events_raw` de la base Postgres du projet. (`docker cp` + `\copy` dans psql, ou tout autre moyen). Connectez Metabase à cette base.

### 2.2 — Dashboard Metabase (4 pts)

Construisez un dashboard « TaskFlow Product Health » avec au moins 4 cartes :

- DAU sur 30 jours (line chart)
- Funnel global (bar chart, 4 étapes)
- Top events (count par event_name)
- Conversion par device (page_view → task_form_submit, sur desktop vs mobile)

Captures d'écran à inclure dans le rapport.

### 2.3 — Chasse au biais (2 pts)

Le dataset contient **au moins un biais statistique** introduit volontairement (paradoxe de Simpson, confondeur, ou similaire). Identifiez-le en croisant plusieurs dimensions (cohort × device par exemple), démontrez-le chiffres à l'appui, et expliquez **pourquoi** l'agrégat brut induit en erreur.

### 2.4 — Recommandations PM (1 pt)

À partir de vos observations, rédigez **3 recommandations produit** pour le PM TaskFlow. Soyez concrets et actionnables (pas « il faut améliorer l'UX » mais « mobile convertit X % moins, A/B tester un onboarding mobile dédié pour les inscrits cohort_B la semaine prochaine »).

---

## Format de rendu

Vous me rendez **le projet corrigé + un rapport** à la racine.

**Nom du rapport** (obligatoire, exactement ce format) : `RAPPORT-NOM-Prenom.md` (par exemple `RAPPORT-DUPONT-Jean.md`).

Le rapport est structuré en 2 parties :

**Partie 1 — Audit**

Pour chaque bug corrigé : décrivez le problème, l'impact concret, et votre correction. Joignez au moins **une capture d'écran Grafana** qui illustre le résultat de la correction d'un des bugs côté dashboard (par exemple le panel p50/p95/p99 qui fonctionne correctement après votre patch). Vous pouvez aussi inclure des captures avant/après pour appuyer votre démonstration.

**Partie 2 — Analyse**

Pour chaque carte du dashboard Metabase : joignez la **capture d'écran** correspondante, la requête SQL utilisée, et un court commentaire sur ce que vous y lisez. Démontrez le biais identifié chiffres à l'appui (idéalement avec un tableau ou une capture comparative). Terminez par vos 3 recommandations PM.

Pas de template imposé sur le style, soyez clairs et concis. Les captures sont obligatoires pour valider que vous avez effectivement fait tourner l'environnement.

---

## Méthodologie suggérée

1. **Lancer le projet**, générer du trafic 10-30 min, observer dans Prometheus / Grafana
2. **Auditer chaque fichier** d'instrumentation en se demandant à chaque ligne : « est-ce que ce code marche en multi-instance / sous charge / avec un utilisateur qui refuse les cookies ? »
3. **Charger le dataset** dans Postgres, brancher Metabase, construire le dashboard
4. **Croiser les dimensions** du dataset pour repérer le biais
5. **Tester votre correctif** avant de passer au suivant

---

## Ressources

- Documentation officielle (Prometheus, MDN sendBeacon, Grafana, Metabase, pino)
- Vos notes de cours et TP
- Les guides fournis dans `docs/grafana-tutoriel.md` et `docs/jaeger-tutoriel.md` à la racine du projet

---

## Remise

Sur **Discord** (DM), au choix :

- **Lien GitHub** vers un repo public — nom contenant vos NOM et Prénom (ex : `taskflow-audit-DUPONT-Jean`)
- **Fichier ZIP** — nommé `taskflow-audit-NOM-Prenom.zip`

Votre nom doit apparaître dans le projet (commit author, fichier RAPPORT-NOM-Prenom.md, README).

**Date limite : samedi 13 juin 2026, 23h59.**
