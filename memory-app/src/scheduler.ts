import { createEmptyCard, fsrs, type Card, type Grade } from "ts-fsrs";

// No fuzz: the same state, timestamp, and rating always produce the same outcome.
export const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: false,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
});
export type Schedule = Omit<Card, "due" | "last_review"> & {
  due: number;
  last_review?: number;
};
export const serializeSchedule = (card: Card): Schedule => ({
  ...card,
  due: card.due.getTime(),
  last_review: card.last_review?.getTime(),
});
export const emptySchedule = (now: number): Schedule =>
  serializeSchedule(createEmptyCard(new Date(now)));
export const hydrateSchedule = (card: Schedule): Card => ({
  ...card,
  due: new Date(card.due),
  last_review:
    card.last_review === undefined ? undefined : new Date(card.last_review),
});
export function schedule(card: Schedule, grade: number, now: number): Schedule {
  if (![1, 2, 3, 4].includes(grade))
    throw new Error("Choose one of the four recall ratings.");
  return serializeSchedule(
    scheduler.next(hydrateSchedule(card), new Date(now), grade as Grade).card,
  );
}
export function intervalLabel(due: number, now: number) {
  const minutes = Math.max(1, Math.round((due - now) / 60000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}
