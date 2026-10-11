import { useEffect, useState } from "react";
import type { SuggestedLabels } from "./label-suggestions";

export function LabelSuggestions({
  english,
  onApply,
}: {
  english: string;
  onApply?: (category: "Vocab" | "Grammar", partOfSpeech: string) => void;
}) {
  const [result, setResult] = useState<{
    text: string;
    labels: SuggestedLabels | null;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [applied, setApplied] = useState("");
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setFailed(false);
    setApplied("");
    import("./label-suggestions")
      .then(({ suggestLabels }) => {
        const labels = suggestLabels(english);
        if (!cancelled) setResult({ text: english, labels });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [english]);
  const labels = result?.text === english ? result.labels : null;
  return (
    <aside className="label-suggestions" aria-label="Suggested labels">
      <strong>Suggested labels</strong>
      <p className="helper">
        English-based hints, not verified Arabic grammar. You can edit every
        label.
      </p>
      {failed ? (
        <p className="helper">
          Suggestions unavailable. Choose labels manually.
        </p>
      ) : !result || result.text !== english ? (
        <p className="helper" role="status">
          Checking labels…
        </p>
      ) : !labels ? (
        <p className="helper">
          No confident suggestion. Your labels are unchanged; choose them
          manually.
        </p>
      ) : (
        <>
          <p className="helper">{labels.explanation}</p>
          <div className="label-options">
            {(labels.partsOfSpeech.length ? labels.partsOfSpeech : [""]).map(
              (pos) => {
                const label = labels.category + (pos ? ` · ${pos}` : "");
                return onApply ? (
                  <button
                    type="button"
                    className="button secondary"
                    key={pos}
                    onClick={() => {
                      onApply(labels.category, pos);
                      setApplied(label);
                    }}
                  >
                    Apply {label}
                  </button>
                ) : (
                  <span key={pos}>{label}</span>
                );
              },
            )}
          </div>
          {onApply ? (
            <p className="helper" role="status">
              {applied
                ? `Applied ${applied}. You can still edit below.`
                : "Your labels stay unchanged until you apply a suggestion."}
            </p>
          ) : (
            <p className="helper">
              Use in a card to choose and apply these labels.
            </p>
          )}
        </>
      )}
    </aside>
  );
}
