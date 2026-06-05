// tracker.js — instrumentation frontend
// Bandeau RGPD, capture des clics, scroll-depth, LCP.

const API = 'http://localhost:3000';
const SESSION_ID = sessionStorage.getItem('sid') || crypto.randomUUID();
sessionStorage.setItem('sid', SESSION_ID);

let consentGiven = localStorage.getItem('consent') === 'yes';

// ---- Bandeau consentement ----
const $consent = document.getElementById('consent');
if (!localStorage.getItem('consent')) {
  $consent.classList.remove('hidden');
}
document.getElementById('consent-accept').addEventListener('click', () => {
  localStorage.setItem('consent', 'yes');
  consentGiven = true;
  $consent.classList.add('hidden');
});
document.getElementById('consent-refuse').addEventListener('click', () => {
  localStorage.setItem('consent', 'no');
  consentGiven = false;
  $consent.classList.add('hidden');
});

// ---- Envoi via sendBeacon ----
function track(eventName, properties = {}) {
  if (!consentGiven) return;
  const payload = {
    event_name: eventName,
    session_id: SESSION_ID,
    occurred_at: new Date().toISOString(),
    properties: { ...properties, url: location.pathname, referrer: document.referrer || null },
  };
  const ok = navigator.sendBeacon(
    `${API}/api/ingest`,
    new Blob([JSON.stringify(payload)], { type: 'application/json' })
  );
  if (!ok) {
    fetch(`${API}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  }
}

// ---- Page view au chargement ----
track('page_view', { title: document.title });

// ---- Capture des clics ----
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-track]');
  if (!el) return;
  track(el.dataset.track, {
    text: el.textContent?.slice(0, 50),
    tag: el.tagName.toLowerCase(),
  });
});

// ---- Scroll depth (paliers 25, 50, 75, 100 %) ----
const sentScrollDepths = new Set();

window.addEventListener('scroll', () => {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (max <= 0) return;
  const pct = Math.round((window.scrollY / max) * 100);
  for (const m of [25, 50, 75, 100]) {
    if (pct >= m && !sentScrollDepths.has(m)) {
      sentScrollDepths.add(m);
      track('scroll_depth', { percent: m });
    }
  }
});

// ---- LCP via PerformanceObserver ----
new PerformanceObserver((list) => {
  const entries = list.getEntries();
  const last = entries[entries.length - 1];
  track('web_vital', { name: 'LCP', value: Math.round(last.startTime) });
}).observe({ type: 'largest-contentful-paint', buffered: true });

console.log('[tracker] initialise. session:', SESSION_ID);
