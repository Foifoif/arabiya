import { z } from "zod";
import { emptySchedule, schedule, type Schedule } from "./scheduler";
export type Mode = "mixed" | "singular" | "matching" | "choice";
export type Format = Exclude<Mode, "mixed">;
export type Result = "correct" | "almost" | "wrong";
export const uid = () =>
  crypto.randomUUID?.() ??
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export const normalize = (s: string) =>
  s
    .normalize("NFC")
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .toLocaleLowerCase()
    .trim();
const str = z.string().max(10000),
  id = z.string().min(1),
  timestamp = z.number().finite().nonnegative();
const scheduleSchema = z.object({
  due: timestamp,
  last_review: timestamp.optional(),
  stability: z.number().nonnegative(),
  difficulty: z.number().min(0).max(10),
  elapsed_days: z.number().nonnegative(),
  scheduled_days: z.number().nonnegative(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  learning_steps: z.number().int().nonnegative(),
  state: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});
export const sideSchema = z.object({
  headline: str.min(1),
  description: str,
  designation: z.enum(["Arabic word", "Explanation", "Other"]),
});
export const contentSchema = z.object({
  front: sideSchema,
  back: sideSchema,
  topic: str.min(1),
  category: z.enum(["", "Vocab", "Grammar"]),
  partOfSpeech: str,
});
export type CardContent = z.infer<typeof contentSchema>;
const cardSchema = contentSchema.extend({
  id,
  revision: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
  archived: z.boolean(),
  schedule: scheduleSchema,
});
export type Card = z.infer<typeof cardSchema>;
const formatSchema = z.enum(["singular", "matching", "choice"]);
const roundSchema = z.object({
  id,
  format: formatSchema,
  cardIds: z.array(id),
  scheduledIds: z.array(id),
  revisions: z.record(id, z.number()),
  side: z.enum(["front", "back"]),
  rightOrder: z.array(id),
  choiceIds: z.array(id),
  revealed: z.boolean(),
  selected: z.string().nullable(),
  matched: z.array(id),
  mistakes: z.array(id),
  results: z.record(id, z.enum(["correct", "almost", "wrong"])),
  submitted: z.boolean(),
  practiceAhead: z.boolean(),
});
export type Round = z.infer<typeof roundSchema>;
export const dataSchema = z.object({
  version: z.literal(2),
  revision: z.number().int().nonnegative(),
  cards: z.array(cardSchema),
  reviews: z.array(
    z.object({
      id,
      roundId: id,
      cardId: id,
      cardRevision: z.number(),
      at: timestamp,
      format: formatSchema,
      result: z.enum(["correct", "almost", "wrong"]),
      scheduled: z.boolean(),
      before: scheduleSchema,
      after: scheduleSchema,
    }),
  ),
  settings: z.object({
    theme: z.enum(["dark", "light"]),
    mode: z.enum(["mixed", "singular", "matching", "choice"]),
    topic: str,
    motion: z.boolean(),
  }),
  links: z.object({ companion: str, audio: str }),
  round: roundSchema.nullable(),
  formatBag: z.array(formatSchema),
  recentFormats: z.array(formatSchema),
  recentCardIds: z.array(id),
});
export type Data = z.infer<typeof dataSchema>;
export const blankContent = (): CardContent => ({
  front: { headline: "", description: "", designation: "Arabic word" },
  back: { headline: "", description: "", designation: "Explanation" },
  topic: "Arabic",
  category: "Vocab",
  partOfSpeech: "Noun",
});
export const contentOf = (card: Card): CardContent => contentSchema.parse(card);
export function initialData(now = Date.now()): Data {
  const words = [
    ["كِتَاب", "book"],
    ["كَلْب", "dog"],
    ["دَجَاجَة", "chicken (bird / hen)"],
    ["أَخ", "brother"],
    ["جَمَل", "camel"],
  ];
  return {
    version: 2,
    revision: 0,
    cards: words.map(([front, back]) => ({
      ...blankContent(),
      id: uid(),
      revision: 1,
      createdAt: now,
      updatedAt: now,
      archived: false,
      front: { headline: front, description: "", designation: "Arabic word" },
      back: { headline: back, description: "", designation: "Explanation" },
      category: "Vocab",
      partOfSpeech: "Noun",
      schedule: emptySchedule(now),
    })),
    reviews: [],
    settings: { theme: "dark", mode: "mixed", topic: "Arabic", motion: true },
    links: { companion: "", audio: "" },
    round: null,
    formatBag: [],
    recentFormats: [],
    recentCardIds: [],
  };
}
export function saveCard(
  data: Data,
  input: CardContent,
  cardId?: string,
  now = Date.now(),
) {
  const content = contentSchema.parse(input);
  for (const side of [content.front, content.back]) {
    side.headline = side.headline.trim();
    if (!side.headline) throw new Error("Enter a headline on both sides.");
  }
  content.topic = content.topic.trim();
  if (!content.topic) throw new Error("Enter a topic.");
  const existing = data.cards.find((c) => c.id === cardId);
  if (existing) {
    if (JSON.stringify(contentOf(existing)) === JSON.stringify(content))
      return existing.id;
    Object.assign(existing, content, {
      revision: existing.revision + 1,
      updatedAt: now,
      schedule: emptySchedule(now),
    });
    if (
      data.round?.cardIds.includes(existing.id) ||
      data.round?.choiceIds.includes(existing.id)
    )
      data.round = null;
    return existing.id;
  }
  const card = {
    ...content,
    id: uid(),
    revision: 1,
    createdAt: now,
    updatedAt: now,
    archived: false,
    schedule: emptySchedule(now),
  };
  data.cards.push(card);
  return card.id;
}
export function archiveCard(data: Data, cardId: string) {
  const c = data.cards.find((c) => c.id === cardId);
  if (!c) return;
  c.archived = !c.archived;
  if (
    data.round?.cardIds.includes(cardId) ||
    data.round?.choiceIds.includes(cardId)
  )
    data.round = null;
}
export const activeCards = (data: Data) =>
  data.cards.filter(
    (c) =>
      !c.archived && (!data.settings.topic || c.topic === data.settings.topic),
  );
export const dueCards = (data: Data, now = Date.now()) =>
  activeCards(data).filter(
    (c) => c.schedule.state === 0 || c.schedule.due <= now,
  );
export function shuffle<T>(values: T[], random = Math.random) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function uniquePairs(cards: Card[]) {
  const fronts = new Set(),
    backs = new Set();
  return cards.filter((c) => {
    const f = normalize(c.front.headline),
      b = normalize(c.back.headline);
    if (fronts.has(f) || backs.has(b)) return false;
    fronts.add(f);
    backs.add(b);
    return true;
  });
}
export function availability(data: Data) {
  const all = activeCards(data);
  return {
    singular: all.length > 0,
    matching: uniquePairs(all).length >= 5,
    choice: uniquePairs(all).length >= 4,
  };
}
function nextFormat(data: Data, random: () => number): Format {
  const available = availability(data);
  if (data.settings.mode !== "mixed") {
    if (!available[data.settings.mode])
      throw new Error(
        data.settings.mode === "matching"
          ? "Matching needs 5 cards with distinct front and back headlines."
          : "Multiple choice needs 4 cards with distinct front and back headlines.",
      );
    return data.settings.mode;
  }
  data.formatBag = data.formatBag.filter((f) => available[f]);
  if (!data.formatBag.length)
    data.formatBag = shuffle(
      (
        [
          "singular",
          "singular",
          "singular",
          "singular",
          "singular",
          "singular",
          "matching",
          "matching",
          "choice",
          "choice",
        ] as Format[]
      ).filter((f) => available[f]),
      random,
    );
  const last = data.recentFormats.at(-1);
  const singles = data.formatBag.filter((f) => f === "singular").length;
  const others = data.formatBag.length - singles;
  const threeSingles =
    data.recentFormats.length >= 3 &&
    data.recentFormats.every((f) => f === "singular");
  let index = data.formatBag.findIndex((f) => {
    if (f === "singular" && threeSingles && others > 0) return false;
    if (f !== "singular" && others === 1 && singles > 3) return false;
    if (f !== "singular" && f === last && data.formatBag.some((x) => x !== f))
      return false;
    return true;
  });
  if (index < 0) index = 0;
  return data.formatBag.splice(index, 1)[0] || "singular";
}
export function nextRound(
  data: Data,
  practiceAhead = false,
  now = Date.now(),
  random = Math.random,
) {
  const all = activeCards(data);
  if (!all.length) {
    data.round = null;
    return;
  }
  const due = dueCards(data, now);
  if (!due.length && !practiceAhead) {
    data.round = null;
    return;
  }
  let candidates = shuffle(practiceAhead ? all : due, random);
  candidates.sort(
    (a, b) =>
      Number(a.schedule.state === 0) - Number(b.schedule.state === 0) ||
      Number(data.recentCardIds.includes(a.id)) -
        Number(data.recentCardIds.includes(b.id)),
  );
  const format = nextFormat(data, random),
    target = candidates[0];
  let picked = [target];
  if (format === "matching")
    picked = uniquePairs([
      target,
      ...candidates.filter((c) => c.id !== target.id),
      ...shuffle(
        all.filter((c) => !candidates.some((x) => x.id === c.id)),
        random,
      ),
    ]).slice(0, 5);
  if (format === "matching" && picked.length !== 5)
    throw new Error(
      "This group has ambiguous headlines. Edit duplicates before matching.",
    );
  const side = random() < 0.5 ? "front" : "back",
    opposite = side === "front" ? "back" : "front";
  const choicePool = uniquePairs([
    target,
    ...shuffle(
      all.filter((c) => c.id !== target.id),
      random,
    ),
  ]).slice(0, 4);
  if (format === "choice" && choicePool.length < 4)
    throw new Error("Add more distinct answers before using multiple choice.");
  const scheduledIds = practiceAhead
    ? []
    : picked.filter((c) => due.some((d) => d.id === c.id)).map((c) => c.id);
  data.round = {
    id: uid(),
    format,
    cardIds:
      format === "matching"
        ? shuffle(picked, random).map((c) => c.id)
        : [target.id],
    scheduledIds,
    revisions: Object.fromEntries(
      (format === "choice" ? choicePool : picked).map((c) => [
        c.id,
        c.revision,
      ]),
    ),
    side,
    rightOrder: shuffle(picked, random).map((c) => c.id),
    choiceIds:
      format === "choice" ? shuffle(choicePool, random).map((c) => c.id) : [],
    revealed: false,
    selected: null,
    matched: [],
    mistakes: [],
    results: {},
    submitted: false,
    practiceAhead,
  };
  data.recentFormats = [...data.recentFormats, format].slice(-3);
  data.recentCardIds = picked.map((c) => c.id);
}
function ensureRound(data: Data) {
  const r = data.round;
  if (!r || r.submitted) throw new Error("Start the next card.");
  for (const id of [...r.cardIds, ...r.choiceIds]) {
    const c = data.cards.find((c) => c.id === id);
    if (!c || c.archived || c.revision !== r.revisions[id])
      throw new Error("This card changed. Start a new round.");
  }
  return r;
}
function commitResults(
  data: Data,
  results: Record<string, Result>,
  now: number,
) {
  const r = ensureRound(data);
  for (const id of r.cardIds) {
    const result = results[id];
    if (!result) throw new Error("Complete this round first.");
    const c = data.cards.find((c) => c.id === id)!;
    const scheduled = r.scheduledIds.includes(id);
    const before = structuredClone(c.schedule);
    const after = scheduled
      ? schedule(
          before,
          result === "wrong" ? 1 : result === "almost" ? 2 : 3,
          now,
        )
      : before;
    data.reviews.push({
      id: `${r.id}:${id}`,
      roundId: r.id,
      cardId: id,
      cardRevision: c.revision,
      at: now,
      format: r.format,
      result,
      scheduled,
      before,
      after,
    });
    c.schedule = after;
  }
  r.results = results;
  r.submitted = true;
  r.revealed = true;
}
export function rateSingular(
  data: Data,
  result: Result,
  roundId: string,
  now = Date.now(),
) {
  if (data.round?.id !== roundId || data.round.submitted) return;
  const r = ensureRound(data);
  if (r.format !== "singular" || !r.revealed)
    throw new Error("Flip the card before rating it.");
  commitResults(data, { [r.cardIds[0]]: result }, now);
}
export function chooseAnswer(
  data: Data,
  choiceId: string,
  roundId: string,
  now = Date.now(),
) {
  if (data.round?.id !== roundId || data.round.submitted) return;
  const r = ensureRound(data);
  if (r.format !== "choice" || !r.choiceIds.includes(choiceId))
    throw new Error("Select an available answer.");
  r.selected = choiceId;
  commitResults(
    data,
    { [r.cardIds[0]]: choiceId === r.cardIds[0] ? "correct" : "wrong" },
    now,
  );
}
export function matchPair(
  data: Data,
  left: string,
  right: string,
  roundId: string,
  now = Date.now(),
) {
  if (data.round?.id !== roundId || data.round.submitted) return;
  const r = ensureRound(data);
  if (
    r.format !== "matching" ||
    !r.cardIds.includes(left) ||
    !r.rightOrder.includes(right)
  )
    throw new Error("Select a card from each column.");
  if (r.matched.includes(left) || r.matched.includes(right)) return;
  if (left !== right) {
    if (!r.mistakes.includes(left)) r.mistakes.push(left);
    return;
  }
  r.matched.push(left);
  if (r.matched.length === 5)
    commitResults(
      data,
      Object.fromEntries(
        r.cardIds.map((id) => [
          id,
          r.mistakes.includes(id) ? "almost" : "correct",
        ]),
      ),
      now,
    );
}
export const searchCards = (data: Data, query: string, archived = false) =>
  data.cards.filter(
    (c) =>
      c.archived === archived &&
      normalize(
        [
          c.front.headline,
          c.back.headline,
          c.front.description,
          c.back.description,
          c.topic,
          c.category,
          c.partOfSpeech,
        ].join(" "),
      ).includes(normalize(query)),
  );
export function sevenDays(data: Data, now = new Date()) {
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (6 - i));
    const end = new Date(day);
    end.setDate(end.getDate() + 1);
    return {
      label: day.toLocaleDateString("en", { weekday: "short" }),
      date: day.toLocaleDateString(),
      count: data.reviews.filter(
        (r) => r.at >= day.getTime() && r.at < end.getTime(),
      ).length,
    };
  });
}
export function safeLink(value: string) {
  if (!value.trim()) return "";
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Use an http or https link without login details.");
  return url.href;
}
export function validateData(input: unknown) {
  const data = dataSchema.parse(input);
  if (
    new Set(data.cards.map((c) => c.id)).size !== data.cards.length ||
    new Set(data.reviews.map((r) => r.id)).size !== data.reviews.length
  )
    throw new Error("Duplicate data identifiers.");
  for (const review of data.reviews)
    if (!data.cards.some((c) => c.id === review.cardId))
      throw new Error("Review has no card.");
  for (const card of data.cards) {
    if (
      !card.front.headline.trim() ||
      !card.back.headline.trim() ||
      !card.topic.trim()
    )
      throw new Error("Card headlines and topic cannot be empty.");
  }
  if (data.round) {
    const r = data.round;
    if (
      (r.format === "matching" && r.cardIds.length !== 5) ||
      (r.format !== "matching" && r.cardIds.length !== 1)
    )
      throw new Error("Invalid round size.");
    if (new Set(r.cardIds).size !== r.cardIds.length)
      throw new Error("Duplicate cards in a round.");
    for (const id of [...r.cardIds, ...r.choiceIds])
      if (
        !data.cards.some(
          (c) => c.id === id && !c.archived && c.revision === r.revisions[id],
        )
      )
        throw new Error("Invalid or outdated round card.");
    if (
      r.scheduledIds.some((id) => !r.cardIds.includes(id)) ||
      r.matched.some((id) => !r.cardIds.includes(id)) ||
      r.mistakes.some((id) => !r.cardIds.includes(id))
    )
      throw new Error("Invalid round progress.");
    if (
      r.format === "choice" &&
      (new Set(r.choiceIds).size !== 4 || !r.choiceIds.includes(r.cardIds[0]))
    )
      throw new Error("Invalid choice options.");
    if (
      r.format === "matching" &&
      (new Set(r.rightOrder).size !== 5 ||
        r.rightOrder.some((id) => !r.cardIds.includes(id)))
    )
      throw new Error("Invalid matching pairs.");
  }
  safeLink(data.links.companion);
  safeLink(data.links.audio);
  return data;
}
