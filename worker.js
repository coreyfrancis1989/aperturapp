// Backs the /access page's "Seats this month" tracker with real state in
// Workers KV. Everything else falls through to the static site unchanged.
//
// - GET  /api/seats        -> { total, taken } for the current UTC month
// - POST /api/seats/claim  -> increments taken (once per email per month),
//                             called when the "Create your account" form
//                             is submitted
//
// Known limitation: the read-modify-write against KV isn't atomic, so two
// claims landing in the same instant could both read the same "taken"
// value and undercount by one. Fine at this signup volume; move to a
// Durable Object if that ever matters.

const TOTAL_SEATS = 60;

// One-time seed so launch month doesn't start at 0 used. Every month after
// this one starts fresh at 0 — see getState().
const SEED_MONTH = '2026-08';
const SEED_TAKEN = 19;

function monthKey(d) {
  return 'seats:' + d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

async function getState(env, key) {
  const raw = await env.SEATS.get(key);
  if (raw) return JSON.parse(raw);
  const monthStr = key.slice(6);
  const state = { taken: monthStr === SEED_MONTH ? SEED_TAKEN : 0, claimants: [] };
  await env.SEATS.put(key, JSON.stringify(state));
  return state;
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/seats' && request.method === 'GET') {
      const state = await getState(env, monthKey(new Date()));
      return json({ total: TOTAL_SEATS, taken: Math.min(state.taken, TOTAL_SEATS) });
    }

    if (url.pathname === '/api/seats/claim' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const email = String(body.email || '').trim().toLowerCase();
      if (!email) return json({ error: 'email required' }, 400);

      const key = monthKey(new Date());
      const state = await getState(env, key);
      if (!state.claimants.includes(email)) {
        if (state.taken < TOTAL_SEATS) state.taken += 1;
        state.claimants.push(email);
        await env.SEATS.put(key, JSON.stringify(state));
      }
      return json({ total: TOTAL_SEATS, taken: Math.min(state.taken, TOTAL_SEATS) });
    }

    return env.ASSETS.fetch(request);
  },
};
