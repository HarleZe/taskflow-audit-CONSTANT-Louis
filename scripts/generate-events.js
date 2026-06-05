// Génère un dataset d'events réaliste (1 mois de trafic) au format CSV.
// Inclut volontairement un Simpson's paradox pour le TP6.
//
// Usage : node scripts/generate-events.js > data/events.csv

import { randomUUID } from 'crypto';

const FUNNEL = ['page_view', 'task_create_click', 'task_form_submit', 'task_toggle'];
const COHORTS = ['cohort_A', 'cohort_B'];
const DEVICES = ['desktop', 'mobile'];
const NUM_SESSIONS = 5000;

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickWeighted(arr, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < arr.length; i++) { r -= weights[i]; if (r <= 0) return arr[i]; }
  return arr[arr.length - 1];
}

const out = [];
out.push('event_name,user_id,session_id,occurred_at,cohort,device,country,duration_ms');

const now = Date.now();
const MS_30D = 30 * 24 * 3600 * 1000;

for (let i = 0; i < NUM_SESSIONS; i++) {
  const userId = `u_${Math.floor(Math.random() * 2000)}`;
  const sessionId = randomUUID();
  const cohort = pick(COHORTS);
  // Mobile sur-représenté dans cohort_B → Simpson's paradox volontaire
  const device = cohort === 'cohort_B'
    ? pickWeighted(DEVICES, [0.3, 0.7])
    : pickWeighted(DEVICES, [0.7, 0.3]);
  const country = pickWeighted(['FR', 'BE', 'CH', 'CA', 'US'], [0.6, 0.1, 0.1, 0.1, 0.1]);
  const sessionStart = now - Math.floor(Math.random() * MS_30D);

  // Funnel : drop progressif. Mobile a un taux de drop plus fort sur task_form_submit.
  const dropRates = device === 'mobile' ? [0.15, 0.35, 0.5] : [0.05, 0.2, 0.3];
  let dropped = false;
  for (let step = 0; step < FUNNEL.length; step++) {
    if (dropped) break;
    const t = sessionStart + step * (1000 + Math.floor(Math.random() * 4000));
    const duration = step === FUNNEL.length - 1 ? Math.floor(Math.random() * 2000) : null;
    out.push([
      FUNNEL[step], userId, sessionId, new Date(t).toISOString(),
      cohort, device, country, duration ?? ''
    ].join(','));
    if (step < dropRates.length && Math.random() < dropRates[step]) dropped = true;
  }
}

console.log(out.join('\n'));
