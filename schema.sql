CREATE TABLE IF NOT EXISTS cards_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_type TEXT, -- 'vocab', 'grammar', 'translation'
  topic TEXT,
  question TEXT,
  was_correct INTEGER, -- 0 or 1
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS streak (
  id INTEGER PRIMARY KEY DEFAULT 1,
  current_streak INTEGER DEFAULT 0,
  last_practice_date TEXT,
  total_cards_ever INTEGER DEFAULT 0,
  daily_goal INTEGER DEFAULT 5,
  cards_today INTEGER DEFAULT 0,
  last_reset_date TEXT
);

CREATE TABLE IF NOT EXISTS weak_spots (
  topic TEXT PRIMARY KEY,
  wrong_count INTEGER DEFAULT 0,
  correct_count INTEGER DEFAULT 0,
  last_seen TEXT
);
