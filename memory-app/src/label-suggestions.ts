import nlp from "compromise";

export type SuggestedLabels = {
  category: "Vocab" | "Grammar";
  partsOfSpeech: string[];
  explanation: string;
};

// English hints only: translation can change the part of speech in Arabic.
// Keep the model behind a dynamic import in LabelSuggestions.tsx.
const model = (
  nlp.world() as {
    model: {
      one: {
        lexicon: Record<string, string | string[]>;
        tagSet: Record<string, { parents?: string[] }>;
      };
    };
  }
).model.one;
const mappings = [
  ["Pronoun", "Pronoun"],
  ["Noun", "Noun"],
  ["Verb", "Verb"],
  ["Adjective", "Adjective"],
  ["Adverb", "Adverb"],
  ["Preposition", "Preposition"],
  ["Conjunction", "Conjunction"],
  ["Determiner", "Determiner"],
  ["Value", "Numeral"],
  ["Expression", "Interjection"],
  ["Negative", "Particle"],
] as const;
function part(tags: string[]): string | undefined {
  const expanded = new Set(
    tags.flatMap((tag) => [tag, ...(model.tagSet[tag]?.parents || [])]),
  );
  return mappings.find(([tag]) => expanded.has(tag))?.[1];
}
const grammarTopic =
  /^(?:(?:the|arabic)\s+)?(?:past tense|present tense|future tense|definite article|indefinite article|subject[- ]verb agreement|nominal sentences?|verbal sentences?|noun cases?|verb conjugation|possessive suffixes?|comparative adjectives?|dual forms?|broken plurals?|grammatical gender)$/i;

export function suggestLabels(english: string): SuggestedLabels | null {
  const text = english
    .trim()
    .replace(/[.!?]+$/, "")
    .toLowerCase();
  if (!text || text.length > 500 || !/^[a-z\s'’,\-]+$/.test(text)) return null;
  if (grammarTopic.test(text))
    return {
      category: "Grammar",
      partsOfSpeech: [],
      explanation:
        "This looks like a grammar topic. Choose a word type only if it applies.",
    };
  const words = text.split(/\s+/);
  if (words.length > 1) {
    const infinitive = /^to\s+(.+)$/.exec(text);
    if (infinitive && nlp(infinitive[1]).has("#Verb"))
      return {
        category: "Vocab",
        partsOfSpeech: ["Verb"],
        explanation: "This looks like an English infinitive (to + verb).",
      };
    return {
      category: "Vocab",
      partsOfSpeech: ["Phrase"],
      explanation:
        "This has several words. Phrase is a starting point for expressions and sentences.",
    };
  }
  const lexical = model.lexicon[text];
  const lexicalPart = lexical
    ? part(Array.isArray(lexical) ? lexical : [lexical])
    : undefined;
  const term = nlp(text).json()[0]?.terms?.[0];
  const parsedPart = part(term?.tags || []);
  // The tagger guesses Noun for unknown words. Abstain instead of presenting that as evidence.
  const derivedAdverb =
    !lexical &&
    parsedPart === "Adverb" &&
    /ly$/.test(text) &&
    [text.slice(0, -2), text.slice(0, -3) + "y"].some((root) => {
      const tags = model.lexicon[root];
      return tags && part(Array.isArray(tags) ? tags : [tags]) === "Adjective";
    });
  if (!lexicalPart && !derivedAdverb) return null;
  const partsOfSpeech = [
    ...new Set([lexicalPart, parsedPart].filter((p): p is string => !!p)),
  ];
  return {
    category: "Vocab",
    partsOfSpeech,
    explanation:
      partsOfSpeech.length > 1
        ? "This English word has more than one possible use. Choose the meaning you intend."
        : "Suggested from the English wording; other uses may be possible.",
  };
}
