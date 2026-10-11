import { describe, expect, it } from "vitest";
import { suggestLabels } from "./label-suggestions";

describe("English-based label hints", () => {
  it.each([
    ["teacher", "Noun"],
    ["children", "Noun"],
    ["to write", "Verb"],
    ["walked", "Verb"],
    ["beautiful", "Adjective"],
    ["quickly", "Adverb"],
    ["happily", "Adverb"],
    ["you", "Pronoun"],
    ["in", "Preposition"],
    ["and", "Conjunction"],
    ["the", "Determiner"],
    ["three", "Numeral"],
    ["hello", "Interjection"],
    ["not", "Particle"],
    ["good morning", "Phrase"],
  ])("suggests %s as %s", (text, pos) => {
    expect(suggestLabels(text)).toMatchObject({
      category: "Vocab",
      partsOfSpeech: [pos],
    });
  });
  it("offers noun/verb alternatives instead of silently choosing an imperative", () => {
    expect(suggestLabels("book")?.partsOfSpeech).toEqual(["Noun", "Verb"]);
  });
  it.each(["asdfgh", "", "كتاب", "x".repeat(501)])(
    "abstains on unsupported input %s",
    (text) => {
      expect(suggestLabels(text)).toBeNull();
    },
  );
  it("distinguishes grammar topics from expressions", () => {
    expect(suggestLabels("Past tense")).toMatchObject({
      category: "Grammar",
      partsOfSpeech: [],
    });
    expect(suggestLabels("I walked past the house")?.category).toBe("Vocab");
  });
});
