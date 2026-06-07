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

const todayStr     = () => new Date().toISOString().split('T')[0];
const yesterdayStr = () => new Date(Date.now() - 86400000).toISOString().split('T')[0];

// ── Migrations ───────────────────────────────────────────────────
async function migrate(db) {
  const steps = [
    `CREATE TABLE IF NOT EXISTS cards_history (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       card_type TEXT, topic TEXT, question TEXT,
       was_correct INTEGER, user TEXT DEFAULT 'Ali',
       created_at TEXT DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE IF NOT EXISTS streak (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       user TEXT DEFAULT 'Ali', current_streak INTEGER DEFAULT 0,
       last_practice_date TEXT, total_cards_ever INTEGER DEFAULT 0,
       daily_goal INTEGER DEFAULT 5, cards_today INTEGER DEFAULT 0,
       last_reset_date TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS weak_spots (
       topic TEXT PRIMARY KEY, user TEXT DEFAULT 'Ali',
       wrong_count INTEGER DEFAULT 0, correct_count INTEGER DEFAULT 0,
       last_seen TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS user_profiles (
       username TEXT PRIMARY KEY,
       created_at TEXT DEFAULT (datetime('now'))
     )`,
    // Stores exam results + ongoing topic mastery (0-100 per topic, JSON blob)
    `CREATE TABLE IF NOT EXISTS user_knowledge (
       username TEXT PRIMARY KEY,
       level TEXT DEFAULT 'beginner',
       overall_score REAL DEFAULT 0,
       topic_scores TEXT DEFAULT '{}',
       summary TEXT DEFAULT '',
       exam_completed INTEGER DEFAULT 0,
       exam_completed_at TEXT,
       last_updated TEXT DEFAULT (datetime('now'))
     )`,
    `ALTER TABLE cards_history ADD COLUMN user TEXT DEFAULT 'Ali'`,
    `ALTER TABLE weak_spots    ADD COLUMN user TEXT DEFAULT 'Ali'`,
    `ALTER TABLE streak        ADD COLUMN user TEXT DEFAULT 'Ali'`,
    `INSERT OR IGNORE INTO user_profiles (username) VALUES ('Ali')`,
    `INSERT OR IGNORE INTO user_knowledge (username) VALUES ('Ali')`,
  ];
  for (const sql of steps) {
    try { await db.prepare(sql).run(); } catch {}
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
      model: 'claude-sonnet-4-5',
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

// ── DB helpers ───────────────────────────────────────────────────
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
  const r = await db.prepare(`
    SELECT topic FROM weak_spots WHERE user = ? AND wrong_count > 0
    ORDER BY (CAST(wrong_count AS REAL) / (wrong_count + correct_count)) DESC LIMIT ?
  `).bind(user, limit).all();
  return r.results?.map(x => x.topic) ?? [];
}

async function recentHistory(db, user, limit = 25) {
  const r = await db.prepare(
    'SELECT topic, question FROM cards_history WHERE user = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(user, limit).all();
  return r.results ?? [];
}

// Build a concise knowledge summary to include in session prompts (~100 tokens)
function buildKnowledgeSummary(knowledge) {
  if (!knowledge || !knowledge.exam_completed) return '';
  let scores = {};
  try { scores = JSON.parse(knowledge.topic_scores || '{}'); } catch {}
  const entries  = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const strong   = entries.filter(([,v]) => v >= 70).map(([k,v]) => `${k} (${v}%)`).join(', ');
  const weak     = entries.filter(([,v]) => v <  50).map(([k,v]) => `${k} (${v}%)`).join(', ');
  return [
    `\nStudent Knowledge Profile (from placement exam + ongoing practice):`,
    `- Level: ${knowledge.level} | Overall score: ${Math.round(knowledge.overall_score)}/100`,
    strong ? `- Strong topics: ${strong}` : '',
    weak   ? `- Needs work: ${weak}`      : '',
    knowledge.summary ? `- Note: ${knowledge.summary}` : '',
  ].filter(Boolean).join('\n');
}

// Recompute topic mastery from cards_history after each session
async function refreshTopicScores(db, user) {
  const r = await db.prepare(`
    SELECT topic,
           COUNT(*) as total,
           SUM(was_correct) as correct
    FROM cards_history WHERE user = ?
    GROUP BY topic
    HAVING total >= 3
  `).bind(user).all();
  if (!r.results?.length) return;

  const existing = await db.prepare('SELECT topic_scores FROM user_knowledge WHERE username = ?').bind(user).first();
  let scores = {};
  try { scores = JSON.parse(existing?.topic_scores || '{}'); } catch {}

  for (const row of r.results) {
    scores[row.topic] = Math.round((row.correct / row.total) * 100);
  }
  await db.prepare('UPDATE user_knowledge SET topic_scores = ?, last_updated = datetime(\'now\') WHERE username = ?')
    .bind(JSON.stringify(scores), user).run();
}

// ── System prompts ───────────────────────────────────────────────
const SESSION_SYSTEM = `You are a warm, encouraging Arabic tutor. Your student is working through "Mastering Arabic Book 1" by Jane Wightwick and Mahmoud Gaafar.

## Curriculum Topics
1. Greetings & Introductions: مرحبا، أهلاً، السلام عليكم، كيف حالك، اسمي، أنا من
2. Numbers 1–100: واحد، اثنان، ثلاثة... عشرة، عشرون، مئة
3. Colors: أحمر، أزرق، أخضر، أصفر، أبيض، أسود، برتقالي، بنفسجي
4. Family: أب، أم، أخ، أخت، ابن، بنت، جد، جدة، عم، خال، زوج، زوجة
5. Days: الأحد، الاثنين، الثلاثاء، الأربعاء، الخميس، الجمعة، السبت
6. Months: يناير، فبراير، مارس، أبريل، مايو، يونيو، يوليو، أغسطس، سبتمبر، أكتوبر، نوفمبر، ديسمبر
7. Definite Article ال: sun vs moon letters, assimilation
8. Noun Gender: masculine/feminine, tā marbūṭa (ة), exceptions
9. Present Tense Verbs: أنا أذهب، أنت تذهب، هو/هي يذهب/تذهب، نحن نذهب
10. Question Words: ما، من، أين، كيف، متى، لماذا، كم، هل
11. Simple Sentences & Nominal Sentences
12. Adjective Agreement: gender and definiteness
13. Genitive Construction (الإضافة)
14. Vocabulary: food, places, objects, weather
15. Prepositions: في، على، من، إلى، مع، بين، أمام، خلف
16. Plurals: sound masculine/feminine, broken plurals

## Output Format — return ONLY a JSON array of exactly 15 cards:
[{"type":"swipe"|"multiple_choice"|"type_answer","topic":"string","question_en":"string","question_ar":"string","answer":"string","options":["string","string","string","string"],"explanation_en":"string"}]

Rules:
- Mix types evenly (5 swipe, 5 multiple_choice, 5 type_answer)
- Vary difficulty: cards 1–5 easy, 6–10 medium, 11–15 harder
- swipe: answer is exactly "true" or "false"
- multiple_choice: answer is the exact correct option string, exactly 4 options
- type_answer: answer is what the student types
- Include question_ar when Arabic script recognition is relevant
- Never repeat questions within the 15 cards
- Tailor difficulty and topic selection to the student profile if provided`;

const EXAM_GEN_SYSTEM = `You are an Arabic language assessor creating a placement exam. Generate exactly 12 diagnostic questions spanning the full beginner-to-intermediate range.

Structure:
- Questions 1–4: Easy (basic greetings, simple vocabulary, true/false script recognition)
- Questions 5–8: Medium (numbers, colors, family, days/months)
- Questions 9–12: Harder (verb conjugation, noun gender, definite article, simple reading)

Mix types: 4 swipe, 4 multiple_choice, 4 type_answer. Cover at least 8 different topics.

Return ONLY a JSON array of 12 cards:
[{"type":"swipe"|"multiple_choice"|"type_answer","topic":"string","question_en":"string","question_ar":"string","answer":"string","options":["string","string","string","string"],"explanation_en":"string"}]

Rules same as regular cards. Make questions unambiguous and clearly assessable.`;

const EXAM_EVAL_SYSTEM = `You are evaluating Arabic placement exam results. The student answered 12 diagnostic questions. You will receive the topic and result (correct/incorrect) for each.

Assign mastery scores and determine their level.

Return ONLY valid JSON:
{
  "level": "beginner"|"elementary"|"intermediate"|"upper-intermediate",
  "overall_score": 0-100,
  "topic_scores": { "topic_name": 0-100 },
  "summary": "2 encouraging sentences: one about what they know, one about what to focus on"
}

Level thresholds: beginner <30%, elementary 30–60%, intermediate 60–80%, upper-intermediate 80%+
Topic scores: 100 if correct, 0 if incorrect (for topics with one question). Average if multiple questions per topic.`;

const EVAL_SYSTEM = `You are an Arabic tutor evaluating a student's typed answer. Be generous: accept answers that are semantically correct even with minor spelling variants, missing/extra vowel marks (harakat), or slight transliteration differences. Respond ONLY with valid JSON: { "correct": boolean, "feedback": string }. Keep feedback to 1 short sentence.`;

// ════════════════════════════════════════════════════════════════
export async function onRequest(context) {
  const { request, env } = context;
  const url    = new URL(request.url);
  const path   = url.pathname;
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { headers: CORS });

  await migrate(env.DB);

  try {

    // ── GET /api/streak ────────────────────────────────────────
    if (method === 'GET' && path === '/api/streak') {
      const user  = url.searchParams.get('user') || 'Ali';
      const row   = await ensureStreak(env.DB, user);
      const spots = await topWeakSpots(env.DB, user);
      const profiles = await env.DB.prepare('SELECT username FROM user_profiles ORDER BY created_at').all();
      return json({ ...row, weak_spots: spots, users: profiles.results?.map(r => r.username) ?? ['Ali'] });
    }

    // ── GET /api/knowledge ─────────────────────────────────────
    if (method === 'GET' && path === '/api/knowledge') {
      const user = url.searchParams.get('user') || 'Ali';
      await env.DB.prepare('INSERT OR IGNORE INTO user_knowledge (username) VALUES (?)').bind(user).run();
      const row = await env.DB.prepare('SELECT * FROM user_knowledge WHERE username = ?').bind(user).first();
      return json(row ?? { username: user, exam_completed: 0 });
    }

    // ── POST /api/exam/generate ────────────────────────────────
    if (method === 'POST' && path === '/api/exam/generate') {
      const raw = await callClaude(env.ANTHROPIC_API_KEY, {
        system:   EXAM_GEN_SYSTEM,
        userMsg:  'Generate the 12-question placement exam now.',
        maxTokens: 4000,
      });
      return json({ questions: parseClaudeJSON(raw) });
    }

    // ── POST /api/exam/evaluate ────────────────────────────────
    // answers: [{ topic, was_correct }]
    if (method === 'POST' && path === '/api/exam/evaluate') {
      const { user = 'Ali', answers = [] } = await request.json();

      const total   = answers.length;
      const correct = answers.filter(a => a.was_correct).length;

      const answersStr = answers.map((a, i) =>
        `${i + 1}. [${a.topic}] ${a.was_correct ? '✓ correct' : '✗ incorrect'}`
      ).join('\n');

      const raw = await callClaude(env.ANTHROPIC_API_KEY, {
        system:   EXAM_EVAL_SYSTEM,
        userMsg:  `Student answered ${correct}/${total} correctly:\n\n${answersStr}`,
        maxTokens: 600,
      });

      const profile = parseClaudeJSON(raw);

      await env.DB.prepare(`
        INSERT OR REPLACE INTO user_knowledge
          (username, level, overall_score, topic_scores, summary, exam_completed, exam_completed_at, last_updated)
        VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
      `).bind(user, profile.level, profile.overall_score,
               JSON.stringify(profile.topic_scores ?? {}), profile.summary ?? '').run();

      return json(profile);
    }

    // ── POST /api/exam/skip ────────────────────────────────────
    if (method === 'POST' && path === '/api/exam/skip') {
      const { user = 'Ali' } = await request.json().catch(() => ({}));
      await env.DB.prepare(`
        INSERT OR REPLACE INTO user_knowledge
          (username, level, overall_score, topic_scores, summary, exam_completed, exam_completed_at, last_updated)
        VALUES (?, 'beginner', 0, '{}', 'Starting from scratch — every expert was once a beginner!', 1, datetime('now'), datetime('now'))
      `).bind(user).run();
      return json({ ok: true, level: 'beginner' });
    }

    // ── POST /api/session ──────────────────────────────────────
    if (method === 'POST' && path === '/api/session') {
      const { user = 'Ali', learning_goal = '', weak_spots = [] } = await request.json().catch(() => ({}));

      const [history, knowledge] = await Promise.all([
        recentHistory(env.DB, user, 25),
        env.DB.prepare('SELECT * FROM user_knowledge WHERE username = ?').bind(user).first(),
      ]);

      const recentStr    = history.length
        ? history.map(c => `- [${c.topic}] ${c.question}`).join('\n')
        : '';
      const profileStr   = buildKnowledgeSummary(knowledge);

      const parts = [];
      if (learning_goal.trim()) parts.push(`The student wants to focus on: "${learning_goal.trim()}". Generate all 15 cards around this theme, varying types and difficulty.`);
      else if (weak_spots.length) parts.push(`Prioritize weak topics: ${weak_spots.join(', ')}.`);
      else parts.push('Choose varied topics appropriate for this student.');
      if (profileStr)  parts.push(profileStr);
      if (recentStr)   parts.push(`\nAvoid repeating these recently seen questions:\n${recentStr}`);

      const raw   = await callClaude(env.ANTHROPIC_API_KEY, {
        system:   SESSION_SYSTEM,
        userMsg:  parts.join('\n'),
        maxTokens: 6000,
      });

      return json({ cards: parseClaudeJSON(raw) });
    }

    // ── POST /api/evaluate ─────────────────────────────────────
    if (method === 'POST' && path === '/api/evaluate') {
      const { question, expected, user_answer } = await request.json();
      const raw = await callClaude(env.ANTHROPIC_API_KEY, {
        system:   EVAL_SYSTEM,
        userMsg:  `Question: "${question}"\nExpected: "${expected}"\nStudent wrote: "${user_answer}"\n\nIs this correct?`,
        maxTokens: 150,
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
        const newStreak = isNewDay
          ? (row.last_practice_date === yesterdayStr() ? row.current_streak + 1 : 1)
          : row.current_streak;
        await env.DB.prepare(`
          UPDATE streak SET
            cards_today = cards_today + 1, total_cards_ever = total_cards_ever + 1,
            last_practice_date = ?, current_streak = ?, last_reset_date = ?
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

      // Refresh topic mastery scores in user_knowledge from full history
      await refreshTopicScores(env.DB, user);

      const updated = await env.DB.prepare('SELECT * FROM streak WHERE user = ? LIMIT 1').bind(user).first();
      const spots   = await topWeakSpots(env.DB, user);
      return json({ ok: true, streak: { ...updated, weak_spots: spots } });
    }

    // ── POST /api/users ────────────────────────────────────────
    if (method === 'POST' && path === '/api/users') {
      const { username } = await request.json();
      if (!username?.trim()) return json({ error: 'username required' }, 400);
      await env.DB.prepare('INSERT OR IGNORE INTO user_profiles (username) VALUES (?)').bind(username.trim()).run();
      await env.DB.prepare('INSERT OR IGNORE INTO user_knowledge (username) VALUES (?)').bind(username.trim()).run();
      return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: err.message }, 500);
  }
}
