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

// ── Migrations (idempotent) ──────────────────────────────────────
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
    try { await db.prepare(sql).run(); } catch {}
  }
}

// ── Claude helper — with optional prompt caching ─────────────────
// Prompt caching cuts costs ~90% on the system prompt tokens.
// The system prompt must be >1024 tokens to qualify; ours is ~1500+.
async function callClaude(apiKey, { system, userMsg, maxTokens = 700, cache = false }) {
  const systemPayload = cache
    ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
    : system;

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
  if (cache) headers['anthropic-beta'] = 'prompt-caching-2024-07-31';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: systemPayload,
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

// ── System prompts ───────────────────────────────────────────────

// SESSION_SYSTEM generates all 5 cards at once — long enough (>1024 tokens)
// to be eligible for Anthropic prompt caching.
const SESSION_SYSTEM = `You are a warm, encouraging Arabic tutor. Your student is at an elementary Modern Standard Arabic (MSA) level, working through "Mastering Arabic Book 1" by Jane Wightwick and Mahmoud Gaafar.

## Student Profile
- Elementary MSA level
- Knows the Arabic alphabet and can read basic script
- Building vocabulary, simple grammar, and conversational foundations
- Learns best with clear explanations and variety

## Full Curriculum — Book 1 Syllabus
1. Greetings & Introductions: مرحبا، أهلاً وسهلاً، السلام عليكم، كيف حالك، اسمي، أنا من، تشرفنا
2. Numbers 1–100: واحد، اثنان، ثلاثة، أربعة، خمسة، ستة، سبعة، ثمانية، تسعة، عشرة، أحد عشر... عشرون، ثلاثون، أربعون، مئة
3. Colors: أحمر، أزرق، أخضر، أصفر، أبيض، أسود، برتقالي، بنفسجي، بني، رمادي، وردي
4. Family Members: أب، أم، أخ، أخت، ابن، بنت، جد، جدة، عم، عمة، خال، خالة، زوج، زوجة، ابن عم
5. Days of the Week: الأحد، الاثنين، الثلاثاء، الأربعاء، الخميس، الجمعة، السبت
6. Months of the Year: يناير، فبراير، مارس، أبريل، مايو، يونيو، يوليو، أغسطس، سبتمبر، أكتوبر، نوفمبر، ديسمبر
7. Definite Article (ال): sun letters (ش س ص ض ط ظ ت ث د ذ ر ز ن ل) vs moon letters; assimilation rules (الشمس vs القمر)
8. Noun Gender: masculine vs feminine; tā marbūṭa (ة) marks feminine; common exceptions (أم، أخت); dual forms
9. Present Tense Verbs (المضارع): أنا أذهب / أكتب / أقرأ، أنت تذهب، هو يذهب، هي تذهب، نحن نذهب، أنتم تذهبون، هم يذهبون
10. Question Words: ما (what), من (who), أين (where), كيف (how), متى (when), لماذا (why), كم (how many/much), هل (yes/no question marker)
11. Simple Sentences & Nominal Sentences: Subject + predicate (أنا طالب، البيت كبير); verb-subject-object order
12. Adjective Agreement: gender and definiteness must agree (المنزل الكبير، البنت الصغيرة، كتاب جديد)
13. Genitive Construction (الإضافة): connecting two nouns (كتاب الطالب، باب البيت، مدينة القاهرة)
14. Common Vocabulary — Food: خبز، ماء، عصير، لحم، دجاج، سمك، خضروات، فاكهة، أرز، شاي، قهوة
15. Common Vocabulary — Places: مدرسة، بيت، مكتب، سوق، مستشفى، مطعم، مطار، فندق، مسجد، متحف
16. Prepositions: في (in/at), على (on), من (from), إلى (to), مع (with), بين (between), أمام (in front of), خلف (behind), فوق (above), تحت (under)
17. Plurals: sound masculine plural (معلمون/معلمين), sound feminine plural (معلمات), broken plurals (كتاب→كتب، بيت→بيوت، رجل→رجال)

## Your Task
Generate exactly 5 practice cards as a valid JSON array. Mix the three card types across the 5 cards. Vary difficulty (2 easy, 2 medium, 1 challenging).

## Output Format — return ONLY this JSON, no other text:
[
  {
    "type": "swipe" | "multiple_choice" | "type_answer",
    "topic": "string",
    "question_en": "string",
    "question_ar": "string (optional — include when Arabic script recognition is part of the challenge)",
    "answer": "string",
    "options": ["string","string","string","string"],
    "explanation_en": "string (1–2 sentences)"
  }
]

## Rules by Card Type
- swipe: answer must be exactly "true" or "false". question_en is a factual statement the student judges.
- multiple_choice: answer is the exact correct option string. options array must have exactly 4 items. Distractors should be plausible but clearly wrong.
- type_answer: answer is what the student types — either an Arabic word/phrase or its English translation. Accept the simplest common form.

## Quality Standards
- Include question_ar whenever the card involves reading or writing Arabic script
- Never repeat the same question twice within one set of 5
- Vary topics across the 5 cards even when focusing on a theme
- Explanations should teach — briefly explain why, not just restate the answer`;

const EVAL_SYSTEM = `You are an Arabic tutor evaluating a student's typed answer. Be generous: accept answers that are semantically correct even with minor spelling variants, missing or extra vowel marks (harakat), or slight transliteration differences. Respond ONLY with valid JSON: { "correct": boolean, "feedback": string }. Keep feedback to 1 short sentence — encouraging if correct, gently corrective if wrong (include the right answer).`;

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

    // ── POST /api/session ──────────────────────────────────────
    // Generates all 5 cards in ONE Claude call with prompt caching.
    // Frontend caches the result in localStorage — refreshing is free.
    if (method === 'POST' && path === '/api/session') {
      const { user = 'Ali', learning_goal = '', weak_spots = [] } = await request.json().catch(() => ({}));

      const history = await recentHistory(env.DB, user, 25);
      const recentStr = history.length
        ? history.map(c => `- [${c.topic}] ${c.question}`).join('\n')
        : '';

      const parts = [];
      if (learning_goal.trim()) {
        parts.push(`The student specifically asked to focus on: "${learning_goal.trim()}". Generate all 5 cards around this topic/goal, but vary the card types and difficulty.`);
      } else if (weak_spots.length) {
        parts.push(`Prioritize these topics the student struggles with: ${weak_spots.join(', ')}.`);
      } else {
        parts.push('Choose varied topics appropriate for this level, mixing different areas of the curriculum.');
      }
      if (recentStr) {
        parts.push(`\nAvoid repeating questions the student has already seen recently:\n${recentStr}`);
      }

      const raw   = await callClaude(env.ANTHROPIC_API_KEY, {
        system:   SESSION_SYSTEM,
        userMsg:  parts.join('\n'),
        maxTokens: 2500,
        cache:    true,  // prompt caching on the big system prompt
      });

      const cards = parseClaudeJSON(raw);
      return json({ cards: Array.isArray(cards) ? cards : [cards] });
    }

    // ── POST /api/evaluate ─────────────────────────────────────
    if (method === 'POST' && path === '/api/evaluate') {
      const { question, expected, user_answer } = await request.json();
      const raw = await callClaude(env.ANTHROPIC_API_KEY, {
        system:   EVAL_SYSTEM,
        userMsg:  `Question: "${question}"\nExpected: "${expected}"\nStudent wrote: "${user_answer}"\n\nIs this correct?`,
        maxTokens: 150,
        cache:    true,
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

      const updated = await env.DB.prepare('SELECT * FROM streak WHERE user = ? LIMIT 1').bind(user).first();
      const spots   = await topWeakSpots(env.DB, user);
      return json({ ok: true, streak: { ...updated, weak_spots: spots } });
    }

    // ── POST /api/users ────────────────────────────────────────
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
