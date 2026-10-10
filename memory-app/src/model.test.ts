import { describe, it, expect } from "vitest";
import {
  initialData,
  nextRound,
  rateSingular,
  chooseAnswer,
  matchPair,
  saveCard,
  contentOf,
  availability,
  archiveCard,
  sevenDays,
  safeLink,
  searchCards,
  type Data,
} from "./model";
import {
  commitData,
  loadData,
  parseBackup,
  exportBackup,
  STORAGE_KEY,
} from "./storage";
const now = Date.parse("2026-10-10T17:00:00Z");
const seeded = () => initialData(now);
function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}
describe("memory cards", () => {
  it("prioritizes due learning cards over unseen cards even after a recent review", () => {
    const d = seeded();
    d.settings.mode = "singular";
    nextRound(d, false, now);
    const id = d.round!.cardIds[0];
    d.round!.revealed = true;
    rateSingular(d, "wrong", d.round!.id, now);
    nextRound(d, false, now + 60000);
    expect(d.round!.cardIds[0]).toBe(id);
  });
  it("starts with five editable words and supports generic topics and side designations", () => {
    const d = seeded();
    expect(d.cards).toHaveLength(5);
    const c = contentOf(d.cards[0]);
    c.topic = "History";
    c.front.designation = "Other";
    c.front.headline = "1066";
    c.back.headline = "Battle of Hastings";
    saveCard(d, c);
    expect(d.cards.at(-1)?.topic).toBe("History");
    expect(searchCards(d, "كتاب")).toHaveLength(1);
  });
  it("requires both headlines and restarts edited card scheduling while preserving history", () => {
    const d = seeded();
    d.settings.mode = "singular";
    nextRound(d, false, now);
    const id = d.round!.cardIds[0];
    d.round!.revealed = true;
    rateSingular(d, "correct", d.round!.id, now);
    const card = d.cards.find((c) => c.id === id)!;
    expect(card.schedule.reps).toBe(1);
    saveCard(
      d,
      { ...contentOf(card), back: { ...card.back, headline: "Edited" } },
      id,
      now + 1,
    );
    expect(card.schedule.reps).toBe(0);
    expect(d.reviews[0].cardRevision).toBe(1);
    expect(d.round).toBeNull();
    expect(() =>
      saveCard(d, {
        ...contentOf(card),
        front: { ...card.front, headline: " " },
      }),
    ).toThrow();
  });
  it("maps singular ratings to FSRS and rejects double submissions or ratings before flip", () => {
    const d = seeded();
    d.settings.mode = "singular";
    nextRound(d, false, now);
    const token = d.round!.id;
    expect(() => rateSingular(d, "wrong", token, now)).toThrow(/Flip/);
    d.round!.revealed = true;
    rateSingular(d, "wrong", token, now);
    rateSingular(d, "wrong", token, now);
    expect(d.reviews).toHaveLength(1);
    expect(d.reviews[0].after.due).toBe(now + 60000);
  });
  it("multiple choice has four unique options and records the actual answer", () => {
    const d = seeded();
    d.settings.mode = "choice";
    nextRound(d, false, now);
    const r = d.round!;
    expect(new Set(r.choiceIds).size).toBe(4);
    chooseAnswer(
      d,
      r.choiceIds.find((id) => id !== r.cardIds[0])!,
      r.id,
      now,
    );
    expect(d.reviews[0].result).toBe("wrong");
    expect(d.reviews).toHaveLength(1);
  });
  it("matching uses five pairs, persists progress, and grades mistakes per card", () => {
    const d = seeded();
    d.settings.mode = "matching";
    nextRound(d, false, now);
    const r = d.round!,
      [a, b] = r.cardIds;
    matchPair(d, a, b, r.id, now);
    expect(d.reviews).toHaveLength(0);
    for (const id of r.cardIds) matchPair(d, id, id, r.id, now);
    expect(d.reviews).toHaveLength(5);
    expect(d.reviews.find((x) => x.cardId === a)?.result).toBe("almost");
    expect(d.reviews.filter((x) => x.result === "correct")).toHaveLength(4);
    matchPair(d, a, a, r.id, now);
    expect(d.reviews).toHaveLength(5);
  });
  it("extra matching partners do not change their schedules", () => {
    const d = seeded();
    d.settings.mode = "matching";
    d.cards.slice(1).forEach((c) => {
      c.schedule.state = 2;
      c.schedule.due = now + 86400000;
    });
    nextRound(d, false, now);
    const r = d.round!;
    expect(r.scheduledIds).toHaveLength(1);
    const before = structuredClone(d.cards.slice(1));
    for (const id of r.cardIds) matchPair(d, id, id, r.id, now);
    expect(d.cards.slice(1)).toEqual(before);
    expect(d.reviews.filter((r) => r.scheduled)).toHaveLength(1);
  });
  it("limits explicit formats and falls back in mixed mode with small decks", () => {
    const d = seeded();
    d.cards.slice(1).forEach((c) => (c.archived = true));
    expect(availability(d)).toEqual({
      singular: true,
      matching: false,
      choice: false,
    });
    d.settings.mode = "matching";
    expect(() => nextRound(d, false, now)).toThrow(/5 cards/);
    d.settings.mode = "mixed";
    nextRound(d, false, now);
    expect(d.round!.format).toBe("singular");
  });
  it("uses a shuffled 60/20/20 format bag and samples both sides", () => {
    const d = seeded();
    let seed = 14;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const formats: string[] = [],
      sides = new Set();
    for (let i = 0; i < 100; i++) {
      nextRound(d, true, now, random);
      formats.push(d.round!.format);
      sides.add(d.round!.side);
    }
    expect(formats.filter((f) => f === "singular")).toHaveLength(60);
    expect(formats.filter((f) => f === "matching")).toHaveLength(20);
    expect(formats.filter((f) => f === "choice")).toHaveLength(20);
    expect(sides.size).toBe(2);
    expect(formats.join(",")).not.toContain(
      "singular,singular,singular,singular",
    );
  });
  it("does not review future cards automatically and separates practice ahead", () => {
    const d = seeded();
    d.settings.mode = "singular";
    d.cards.forEach((c) => {
      c.schedule.state = 2;
      c.schedule.due = now + 86400000;
    });
    nextRound(d, false, now);
    expect(d.round).toBeNull();
    nextRound(d, true, now);
    const before = structuredClone(d.cards);
    d.round!.revealed = true;
    rateSingular(d, "correct", d.round!.id, now);
    expect(d.cards).toEqual(before);
    expect(d.reviews[0].scheduled).toBe(false);
  });
  it("archives without deleting history and validates resource URLs", () => {
    const d = seeded();
    nextRound(d, false, now);
    const id = d.round!.cardIds[0];
    archiveCard(d, id);
    expect(d.round).toBeNull();
    expect(searchCards(d, "", true)).toHaveLength(1);
    expect(() => safeLink("javascript:alert(1)")).toThrow();
    expect(safeLink("https://example.com")).toBe("https://example.com/");
  });
  it("counts Home card reviews in seven local calendar days", () => {
    const d = seeded();
    d.settings.mode = "matching";
    nextRound(d, false, now);
    for (const id of d.round!.cardIds) matchPair(d, id, id, d.round!.id, now);
    expect(sevenDays(d, new Date(now)).at(-1)?.count).toBe(5);
    expect(
      sevenDays(d, new Date(now + 8 * 86400000)).reduce(
        (s, x) => s + x.count,
        0,
      ),
    ).toBe(0);
  });
  it("persists progress and validates a complete backup round trip", () => {
    const store = memory();
    let d = loadData(store);
    d = commitData(store, d, (state) => {
      state.settings.mode = "matching";
      nextRound(state);
      const id = state.round!.cardIds[0];
      matchPair(state, id, id, state.round!.id);
    });
    expect(loadData(store)).toEqual(d);
    expect(parseBackup(exportBackup(d))).toEqual(d);
    expect(() => parseBackup("{}")).toThrow();
  });
  it("leaves data untouched after storage failure and rejects stale writes", () => {
    const store = memory(),
      d = loadData(store);
    const fail = {
      getItem: store.getItem,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() =>
      commitData(fail, d, (x) => {
        x.cards = [];
      }),
    ).toThrow(/quota/);
    expect(loadData(store).cards).toHaveLength(5);
    commitData(store, d, (x) => {
      x.settings.theme = "light";
    });
    expect(() =>
      commitData(store, d, (x) => {
        x.settings.theme = "dark";
      }),
    ).toThrow(/another tab/);
  });
});
