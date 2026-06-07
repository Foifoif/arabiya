const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

const todayStr    = () => new Date().toISOString().split('T')[0];
const yesterdayStr= () => new Date(Date.now() - 86400000).toISOString().split('T')[0];

// ── One-time migrations (idempotent — errors are silently ignored) ─
async function migrate(db) {
  const steps = [
    `ALTER TABLE cards_history ADD COLUMN user TEXT DEFAULT 'Ali'`,
    `ALTER TABLE weak_spots    ADD COLUMN user TEXT DEFAULT 'Ali'`,
    `ALTER TABLE streak        ADD COLUMN user TEXT DEFAULT 'Ali'`,
    `CREATE TABLE IF NOT EXISTS user_profiles (
       username TEXT PRIMARY KEY,
       created_at TEXT DEFAULT (datetime('now'))
     )`,
    `INSERT OR IGNORE INTO user_profiles (username) VALUES ('Ali')`,
  ];
  for (const sql of steps) {
    try { await db.prepare(sql).run(); } catch {} // "duplicate column" errors are fine
  }
}

// ── Claude helper ────────────────────────────────────────────────
async function callClaude(apiKey, { system, userMsg, maxTokens = 700 }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  return (await res.json()).content[0].text;
}

function parseClaudeJSON(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fence ? fence[1].trim() : text.trim());
}

// ── Streak helpers ───────────────────────────────────────────────
async function ensureStreak(db, user) {
  await db.prepare(`
    INSERT OR IGNORE INTO streak
      (id, user, current_streak, last_practice_date, total_cards_ever, daily_goal, cards_today, last_reset_date)
    VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM streak), ?, 0, NULL, 0, 5, 0, ?)
  `).bind(user, todayStr()).run();

  let row = await db.prepare('SELECT * FROM streak WHERE user = ? ORDER BY id LIMIT 1').bind(user).first();

  if (row && row.last_reset_date !== todayStr()) {
    await db.prepare('UPDATE streak SET cards_today = 0, last_reset_date = ? WHERE user = ?')
      .bind(todayStr(), user).run();
    row = { ...row, cards_today: 0, last_reset_date: todayStr() };
  }
  return row;
}

async function topWeakSpots(db, user, limit = 5) {
  const result = await db.prepare(`
    SELECT topic FROM weak_spots
    WHERE user = ? AND wrong_count > 0
    ORDER BY (CAST(wrong_count AS REAL) / (wrong_count + correct_count)) DESC
    LIMIT ?
  `).bind(user, limit).all();
  return result.results?.map(r => r.topic) ?? [];
}

// ── Recent card history (for novelty) ───────────────────────────
async function recentCards(db, user, limit = 20) {
  const result = await db.prepare(`
    SELECT topic, question FROM cards_history
    WHERE user = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(user, limit).all();
  return result.results ?? [];
}

// ── System prompts ───────────────────────────────────────────────
const CARD_SYSTEM = `You are an Arabic tutor. The student is at an elementary MSA level, finishing Mastering Arabic Book 1 by Jane Wightwick. Generate a single practice card as JSON.

Card types: 'swipe' (true/false statement), 'multiple_choice' (4 options), or 'type_answer' (open response).

Topics to draw from: greetings, numbers, colors, family, days/months, verb conjugation (present tense), noun gender, definite article (ال), simple sentences, question words (ما، من، أين، كيف).

If weak_spots are provided, weight toward those topics.
If recent_cards are provided, do NOT repeat those exact questions and vary the topics covered.

Respond ONLY with valid JSON in this shape:
{ "type", "topic", "question_en", "question_ar", "answer", "options"?: string[], "explanation_en" }

Rules:
- For swipe cards: answer is "true" or "false". question_en is a true/false statement.
- For multiple_choice: answer is the exact correct option string. options array has exactly 4 items.
- For type_answer: answer is the expected Arabic or English string.
- question_ar is optional but include it when the card involves recognising Arabic script.
- Keep explanations concise, 1-2 sentences.`;

const EVAL_SYSTEM = `You are an Arabic tutor evaluating a student's typed answer. Be generous: accept answers that are semantically correct even if they have minor spelling variants, missing/extra vowel marks (harakat), or slight transliteration differences. Respond ONLY with valid JSON: { "correct": boolean, "feedback": string }. Keep feedback to 1 short sentence — encouraging if correct, gently corrective if wrong (include the right answer).`;

// ════════════════════════════════════════════════════════════════
export async function onRequest(context) {
  const { request, env } = context;
  const url    = new URL(request.url);
  const path   = url.pathname;
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { headers: CORS });

  // Run migrations on every request (cheap — all are no-ops after first run)
  await migrate(env.DB);

  try {
    // ── GET /api/streak?user=Ali ───────────────────────────────
    if (method === 'GET' && path === '/api/streak') {
      const user  = url.searchParams.get('user') || 'Ali';
      const row   = await ensureStreak(env.DB, user);
      const spots = await topWeakSpots(env.DB, user);

      // Return all user profiles so the dropdown can list them
      const profiles = await env.DB.prepare('SELECT username FROM user_profiles ORDER BY created_at').all();
      const users = profiles.results?.map(r => r.username) ?? ['Ali'];

      return json({ ...row, weak_spots: spots, users });
    }

    // ── POST /api/card ─────────────────────────────────────────
    if (method === 'POST' && path === '/api/card') {
      const body = await request.json().catch(() => ({}));
      const { user = 'Ali', topic, type, weak_spots = [] } = body;

      // Fetch recent history to avoid repetition
      const history = await recentCards(env.DB, user, 20);
      const recentStr = history.length
        ? history.map(c => `- [${c.topic}] ${c.question}`).join('\n')
        : '';

      const parts = [];
      if (weak_spots.length) parts.push(`Weak spots to prioritize: ${weak_spots.join(', ')}.`);
      if (topic)             parts.push(`Preferred topic: ${topic}.`);
      if (type)              parts.push(`Preferred card type: ${type}.`);
      if (!parts.length)     parts.push('Choose any topic and type appropriate for this level.');
      if (recentStr)         parts.push(`\n\nRecently seen cards — do NOT repeat these questions, and vary the topics covered:\n${recentStr}`);

      const raw  = await callClaude(env.ANTHROPIC_API_KEY, {
        system: CARD_SYSTEM,
        userMsg: parts.join(' '),
        maxTokens: 600,
      });
      return json(parseClaudeJSON(raw));
    }

    // ── POST /api/evaluate ─────────────────────────────────────
    if (method === 'POST' && path === '/api/evaluate') {
      const { question, expected, user_answer } = await request.json();
      const userMsg = `Question: "${question}"\nExpected answer: "${expected}"\nStudent wrote: "${user_answer}"\n\nIs the student's answer correct?`;
      const raw = await callClaude(env.ANTHROPIC_API_KEY, {
        system: EVAL_SYSTEM, userMsg, maxTokens: 150,
      });
      return json(parseClaudeJSON(raw));
    }

    // ── POST /api/record ───────────────────────────────────────
    if (method === 'POST' && path === '/api/record') {
      const { card_type, topic, question, was_correct, user = 'Ali' } = await request.json();

      await env.DB.prepare(
        'INSERT INTO cards_history (card_type, topic, question, was_correct, user) VALUES (?, ?, ?, ?, ?)'
      ).bind(card_type, topic, question, was_correct, user).run();

      const row = await ensureStreak(env.DB, user);
      if (row) {
        const isNewDay  = row.last_practice_date !== todayStr();
        const wasYday   = row.last_practice_date === yesterdayStr();
        const newStreak = isNewDay ? (wasYday ? row.current_streak + 1 : 1) : row.current_streak;

        await env.DB.prepare(`
          UPDATE streak
          SET cards_today       = cards_today + 1,
              total_cards_ever  = total_cards_ever + 1,
              last_practice_date = ?,
              current_streak    = ?,
              last_reset_date   = ?
          WHERE user = ?
        `).bind(todayStr(), newStreak, todayStr(), user).run();
      }

      await env.DB.prepare(`
        INSERT INTO weak_spots (topic, user, wrong_count, correct_count, last_seen)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(topic) DO UPDATE SET
          wrong_count   = wrong_count   + excluded.wrong_count,
          correct_count = correct_count + excluded.correct_count,
          last_seen     = datetime('now')
      `).bind(topic, user, was_correct ? 0 : 1, was_correct ? 1 : 0).run();

      const updated = await env.DB.prepare('SELECT * FROM streak WHERE user = ? LIMIT 1').bind(user).first();
      const spots   = await topWeakSpots(env.DB, user);
      return json({ ok: true, streak: { ...updated, weak_spots: spots } });
    }

    // ── POST /api/users (add a new user profile) ───────────────
    if (method === 'POST' && path === '/api/users') {
      const { username } = await request.json();
      if (!username?.trim()) return json({ error: 'username required' }, 400);
      await env.DB.prepare('INSERT OR IGNORE INTO user_profiles (username) VALUES (?)').bind(username.trim()).run();
      return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: err.message }, 500);
  }
}
