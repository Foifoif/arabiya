import {
  useState,
  useRef,
  useEffect,
  useId,
  cloneElement,
  type ReactElement,
  type ReactNode,
  type FormEvent,
  type PointerEvent,
} from "react";
import {
  Home as HomeIcon,
  Layers,
  SlidersHorizontal,
  Wrench,
  Search,
  Plus,
  ArrowRight,
  ArrowLeft,
  ArrowUpRight,
  RotateCcw,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Sun,
  Moon,
  BookOpen,
  Headphones,
  Download,
  Upload,
  Archive,
  Pencil,
  Languages,
  Shuffle,
  Columns2,
  ListChecks,
  Square,
  CheckCheck,
} from "lucide-react";
import {
  activeCards,
  archiveCard,
  availability,
  blankContent,
  chooseAnswer,
  contentOf,
  dueCards,
  matchPair,
  nextRound,
  rateSingular,
  safeLink,
  saveCard,
  searchCards,
  sevenDays,
  type Card,
  type CardContent,
  type Data,
  type Format,
  type Mode,
  type Result,
  uid,
} from "./model";
import {
  commitData,
  exportBackup,
  loadData,
  parseBackup,
  STORAGE_KEY,
} from "./storage";
import { translate } from "./translation";
import { CloudPanel, useCloudSync, statusLabel } from "./CloudPanel";
import { intervalLabel, schedule } from "./scheduler";
type Page = "home" | "cards" | "tools" | "more";
type Commit = (mutate: (d: Data) => void) => boolean;
const formats: { value: Mode; label: string; icon: typeof Square }[] = [
  { value: "mixed", label: "Mixed", icon: Shuffle },
  { value: "singular", label: "Singular", icon: Square },
  { value: "matching", label: "Matching", icon: Columns2 },
  { value: "choice", label: "Multiple choice", icon: ListChecks },
];
const formatLabel = (format: Mode) =>
  formats.find((f) => f.value === format)!.label;
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something could not be saved.";
function download(name: string, body: string) {
  const url = URL.createObjectURL(
    new Blob([body], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(
        children as ReactElement<{ id?: string; "aria-describedby"?: string }>,
        { id, "aria-describedby": hint ? `${id}-hint` : undefined },
      )}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
function SideText({
  side,
  className = "",
}: {
  side: CardContent["front"];
  className?: string;
}) {
  return (
    <div
      className={`${side.designation === "Arabic word" ? "arabic" : ""} ${className}`}
      dir="auto"
      lang={side.designation === "Arabic word" ? "ar" : undefined}
    >
      {side.headline}
    </div>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      aria-label={title}
    >
      <div className="dialog-content">
        <div className="section-heading">
          <h2>{title}</h2>
          <button className="icon-button" onClick={close} aria-label="Close">
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
function useDraft<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") ?? initial;
    } catch {
      return initial;
    }
  });
  const [error, setError] = useState("");
  return {
    value,
    error,
    update: (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
        setError("");
      } catch {
        setError("Your edits could not be saved locally. Keep this page open.");
      }
    },
    clear: () => {
      setValue(initial);
      localStorage.removeItem(key);
    },
  };
}
export default function App() {
  const [boot] = useState(() => {
    try {
      let data = loadData(localStorage);
      if (!data.round && dueCards(data).length)
        data = commitData(localStorage, data, (d) => nextRound(d));
      return { data, error: "" };
    } catch (e) {
      return { data: null, error: message(e) };
    }
  });
  const [data, setData] = useState<Data | null>(boot.data),
    ref = useRef(data);
  ref.current = data;
  const [page, setPage] = useState<Page>("home"),
    [error, setError] = useState(boot.error),
    [edit, setEdit] = useState<string | null>(null),
    [prefill, setPrefill] = useState<CardContent | null>(null),
    [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (data) document.documentElement.dataset.theme = data.settings.theme;
  }, [data?.settings.theme]);
  useEffect(() => {
    function update(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      try {
        const d = loadData(localStorage);
        setData(d);
        ref.current = d;
      } catch (e) {
        setError(message(e));
      }
    }
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);
  const commit: Commit = (mutate) => {
    try {
      const next = commitData(localStorage, ref.current!, mutate);
      setData(next);
      ref.current = next;
      setError("");
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    }
  };
  const cloud = useCloudSync(data, () => loadData(localStorage), (incoming) => {
    const next = commitData(localStorage, ref.current!, d => {
      Object.assign(d, incoming, { revision: d.revision, round: null, formatBag: [], recentFormats: [], recentCardIds: [] });
    });
    ref.current = next;
    setData(next);
  });
  function go(next: Page) {
    setPage(next);
    setEdit(null);
    window.scrollTo(0, 0);
  }
  if (!data)
    return (
      <main className="recovery">
        <h1>Could not open your cards</h1>
        <p role="alert">{error}</p>
        <p>Stored data has not been replaced.</p>
        <button
          className="button"
          onClick={() =>
            download(
              "memory-recovery.json",
              localStorage.getItem(STORAGE_KEY) || "",
            )
          }
        >
          Download stored data
        </button>
      </main>
    );
  const topics = [
    ...new Set(data.cards.filter((c) => !c.archived).map((c) => c.topic)),
  ];
  const navItems: [Page, string, typeof HomeIcon][] = [
    ["home", "Home", HomeIcon],
    ["cards", "Cards", Layers],
    ["tools", "Tools", Wrench],
    ["more", "More", SlidersHorizontal],
  ];
  return (
    <div
      className={`app ${!data.settings.motion ? "no-motion" : ""} ${page === "home" ? "home-app" : ""}`}
    >
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => go("home")}
          aria-label="Memory home"
        >
          <span className="brand-icon">
            <span />
            <span />
          </span>
          <span>
            Memory<span className="brand-period">.</span>
          </span>
        </button>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navItems.map(([key, label, Icon]) => (
            <button
              key={key}
              aria-label={label}
              className={page === key ? "active" : ""}
              onClick={() => go(key)}
              aria-current={page === key ? "page" : undefined}
            >
              <Icon size={19} />
              <span>{label}</span>
              {key === "cards" && (
                <span className="nav-count">
                  {data.cards.filter((c) => !c.archived).length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="topic-marker">Aa</div>
          <div>
            <strong>{data.settings.topic || "All topics"}</strong>
            <span>{cloud.state.email ? "Cloud collection" : "Local collection"}</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>
            <strong>{navItems.find((n) => n[0] === page)![1]}</strong>
          </div>
          <span className="mobile-brand">
            Memory<span>.</span>
          </span>
          <div className="topbar-actions">
            <span className="saved-status">
              <span />
              {statusLabel[cloud.state.status]}
            </span>
            <button
              className="icon-button theme-toggle"
              aria-label={`Switch to ${data.settings.theme === "dark" ? "light" : "dark"} mode`}
              onClick={() =>
                commit((d) => {
                  d.settings.theme =
                    d.settings.theme === "dark" ? "light" : "dark";
                })
              }
            >
              {data.settings.theme === "dark" ? (
                <Sun size={18} />
              ) : (
                <Moon size={18} />
              )}
            </button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Dismiss error">
              <X size={17} />
            </button>
          </div>
        )}
        <main>
          {page !== "more" && ["connect", "conflict", "error", "signed-out", "offline"].includes(cloud.state.status) && (
            <div className="cloud-banner" role="status">
              <span>{statusLabel[cloud.state.status]}</span>
              <button className="text-button" onClick={() => go("more")}>Manage cloud saving</button>
            </div>
          )}
          {page === "home" ? (
            <Home
              data={data}
              now={now}
              commit={commit}
              topics={topics}
              go={go}
            />
          ) : page === "cards" ? (
            <Cards
              data={data}
              commit={commit}
              edit={edit}
              setEdit={setEdit}
              prefill={prefill}
              clearPrefill={() => setPrefill(null)}
              notify={setNotice}
            />
          ) : page === "tools" ? (
            <Tools
              data={data}
              commit={commit}
              useCard={(c) => {
                setPrefill(c);
                go("cards");
              }}
            />
          ) : (
            <More data={data} commit={commit} now={now} notify={setNotice}
              cloudPanel={<CloudPanel cloud={cloud} data={data} />} />
          )}
        </main>
        <footer className="workspace-footer">
          <span>Memory</span>
          <span>
            {data.cards.filter((c) => !c.archived).length} cards
          </span>
        </footer>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => go(key)}
            className={page === key ? "active" : ""}
          >
            <Icon size={19} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
    </div>
  );
}
function Home({
  data,
  now,
  commit,
  topics,
  go,
}: {
  data: Data;
  now: number;
  commit: Commit;
  topics: string[];
  go: (p: Page) => void;
}) {
  const round = data.round,
    available = availability(data),
    due = dueCards(data, now),
    cards = activeCards(data),
    today = sevenDays(data, new Date(now)).at(-1)!.count;
  const [answer, setAnswer] = useState(""),
    [left, setLeft] = useState<string | null>(null),
    [feedback, setFeedback] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setAnswer("");
    setLeft(null);
    setFeedback("");
  }, [round?.id]);
  const card = round
    ? data.cards.find((c) => c.id === round.cardIds[0])
    : undefined;
  function next(ahead = round?.practiceAhead || false) {
    if (commit((d) => nextRound(d, ahead))) setFeedback("");
  }
  function tilt(e: PointerEvent<HTMLDivElement>) {
    if (
      !data.settings.motion ||
      e.pointerType !== "mouse" ||
      matchMedia("(prefers-reduced-motion:reduce)").matches
    )
      return;
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty(
      "--rx",
      `${(-(e.clientY - r.top - r.height / 2) / r.height) * 4}deg`,
    );
    e.currentTarget.style.setProperty(
      "--ry",
      `${((e.clientX - r.left - r.width / 2) / r.width) * 5}deg`,
    );
  }
  function mode(value: Mode) {
    commit((d) => {
      d.settings.mode = value;
      d.formatBag = [];
      nextRound(d, false);
    });
  }
  const complete = round?.submitted;
  const scheduled = round?.scheduledIds.length || 0;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">REVIEW</span>
          <h1>Home</h1>
        </div>
        <label className="topic-select">
          <span>Topic</span>
          <select
            aria-label="Review topic"
            value={data.settings.topic}
            onChange={(e) =>
              commit((d) => {
                d.settings.topic = e.target.value;
                d.round = null;
                nextRound(d);
              })
            }
          >
            <option value="">All topics</option>
            {topics.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="home-layout">
        <section className="practice-area">
          <div className="mode-bar" aria-label="Review format">
            {formats.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                className={data.settings.mode === value ? "selected" : ""}
                aria-pressed={data.settings.mode === value}
                onClick={() => mode(value)}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="round-header">
            <span className="eyebrow">
              {round ? formatLabel(round.format).toUpperCase() : "REVIEW"}
            </span>
            <span>
              {round?.practiceAhead ? "Extra practice" : `${due.length} due`}
              {round?.format === "matching" &&
                ` · ${round.matched.length}/5 matched`}
            </span>
          </div>
          {!round || !card ? (
            <div className="no-due">
              <Layers size={32} />
              <h2>
                {due.length
                  ? "Cards ready"
                  : cards.length
                    ? "No cards due"
                    : "No cards in this topic"}
              </h2>
              <p>
                {due.length
                  ? "Continue with your scheduled cards."
                  : cards.length
                    ? "Your next review is scheduled. You can practice now without changing it."
                    : "Add a card to start reviewing."}
              </p>
              {cards.length ? (
                <button
                  className="button primary"
                  onClick={() => next(!due.length)}
                >
                  {due.length ? "Review due cards" : "Practice now"}{" "}
                  <ArrowRight size={17} />
                </button>
              ) : (
                <button className="button primary" onClick={() => go("cards")}>
                  Add Card <Plus size={17} />
                </button>
              )}
            </div>
          ) : (
            <>
              {round.format === "singular" && (
                <>
                  <div
                    key={round.id}
                    ref={cardRef}
                    className={`study-card ${round.revealed ? "flipped" : ""}`}
                    onPointerMove={tilt}
                    onPointerLeave={() => {
                      cardRef.current?.style.setProperty("--rx", "0deg");
                      cardRef.current?.style.setProperty("--ry", "0deg");
                    }}
                  >
                    <div className="card-top">
                      <span>
                        {card.category || "CARD"}
                        {card.partOfSpeech && ` / ${card.partOfSpeech}`}
                      </span>
                      <span>
                        {round.revealed
                          ? round.side === "front"
                            ? "BACK"
                            : "FRONT"
                          : round.side.toUpperCase()}
                      </span>
                    </div>
                    <div className="card-content">
                      <span className="card-designation">
                        {
                          card[
                            round.revealed
                              ? round.side === "front"
                                ? "back"
                                : "front"
                              : round.side
                          ].designation
                        }
                      </span>
                      <SideText
                        side={
                          card[
                            round.revealed
                              ? round.side === "front"
                                ? "back"
                                : "front"
                              : round.side
                          ]
                        }
                        className="card-headline"
                      />
                      {card[
                        round.revealed
                          ? round.side === "front"
                            ? "back"
                            : "front"
                          : round.side
                      ].description && (
                        <p className="card-description" dir="auto">
                          {
                            card[
                              round.revealed
                                ? round.side === "front"
                                  ? "back"
                                  : "front"
                                : round.side
                            ].description
                          }
                        </p>
                      )}
                    </div>
                    <div className="card-bottom">
                      <span>{card.topic}</span>
                      <button
                        aria-label="Turn card over"
                        onClick={() =>
                          commit((d) => {
                            d.round!.revealed = !d.round!.revealed;
                          })
                        }
                        disabled={complete}
                      >
                        <RotateCcw size={17} />
                      </button>
                    </div>
                  </div>
                  <div className="answer-input">
                    <Field label="Your answer (optional)">
                      <input
                        dir="auto"
                        placeholder="Type your answer"
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        disabled={complete}
                      />
                    </Field>
                  </div>
                  {!round.revealed && !complete ? (
                    <button
                      className="button primary full flip-button"
                      onClick={() =>
                        commit((d) => {
                          d.round!.revealed = true;
                        })
                      }
                    >
                      Flip card <RotateCcw size={17} />
                    </button>
                  ) : !complete ? (
                    <div className="self-ratings">
                      {(["wrong", "almost", "correct"] as Result[]).map(
                        (result) => (
                          <button
                            className={`rating ${result}`}
                            key={result}
                            onClick={() =>
                              commit((d) => rateSingular(d, result, round.id))
                            }
                          >
                            <span>
                              {result === "wrong"
                                ? "Wrong"
                                : result === "almost"
                                  ? "Hard"
                                  : "Correct"}
                            </span>
                            <small>
                              {scheduled
                                ? intervalLabel(
                                    schedule(
                                      card.schedule,
                                      result === "wrong"
                                        ? 1
                                        : result === "almost"
                                          ? 2
                                          : 3,
                                      now,
                                    ).due,
                                    now,
                                  )
                                : "Extra practice"}
                            </small>
                          </button>
                        ),
                      )}
                    </div>
                  ) : null}
                </>
              )}
              {round.format === "choice" && (
                <>
                  <div className="choice-prompt">
                    <div className="card-top">
                      <span>
                        {card.category || "CARD"}
                        {card.partOfSpeech && ` / ${card.partOfSpeech}`}
                      </span>
                      <span>{round.side.toUpperCase()}</span>
                    </div>
                    <SideText
                      side={card[round.side]}
                      className="card-headline"
                    />
                    {card[round.side].description && (
                      <p dir="auto">{card[round.side].description}</p>
                    )}
                  </div>
                  <div className="choice-options">
                    {round.choiceIds.map((id, index) => {
                      const candidate = data.cards.find((c) => c.id === id)!;
                      const side = round.side === "front" ? "back" : "front";
                      return (
                        <button
                          key={id}
                          className={`choice-option ${complete && id === card.id ? "correct" : ""} ${complete && round.selected === id && id !== card.id ? "wrong" : ""}`}
                          disabled={complete}
                          onClick={() =>
                            commit((d) => chooseAnswer(d, id, round.id))
                          }
                        >
                          <span className="option-letter">{"ABCD"[index]}</span>
                          <SideText side={candidate[side]} />
                          {complete && id === card.id && <Check size={18} />}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              {round.format === "matching" && (
                <div className="matching">
                  <div className="matching-head">
                    <span>FRONT</span>
                    <span>BACK</span>
                  </div>
                  <div className="matching-columns">
                    <div>
                      {round.cardIds.map((id) => {
                        const c = data.cards.find((c) => c.id === id)!;
                        const matched = round.matched.includes(id);
                        return (
                          <button
                            key={id}
                            className={`match-tile ${left === id ? "selected" : ""} ${matched ? "matched" : ""}`}
                            disabled={matched || complete}
                            aria-pressed={left === id}
                            onClick={() => {
                              setLeft(id);
                              setFeedback("");
                            }}
                          >
                            <SideText side={c.front} />
                            {matched && <Check size={16} />}
                          </button>
                        );
                      })}
                    </div>
                    <div>
                      {round.rightOrder.map((id) => {
                        const c = data.cards.find((c) => c.id === id)!;
                        const matched = round.matched.includes(id);
                        return (
                          <button
                            key={id}
                            className={`match-tile ${matched ? "matched" : ""}`}
                            disabled={matched || complete}
                            onClick={() => {
                              if (!left) {
                                setFeedback("Select a front headline first.");
                                return;
                              }
                              if (
                                commit((d) => matchPair(d, left, id, round.id))
                              ) {
                                setFeedback(
                                  left === id
                                    ? "Matched."
                                    : "Not a match. Try again.",
                                );
                                if (left === id) setLeft(null);
                              }
                            }}
                          >
                            <SideText side={c.back} />
                            {matched && <Check size={16} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <p className="match-feedback" role="status">
                    {feedback ||
                      "Select a headline on the left, then its match on the right."}
                  </p>
                </div>
              )}
              {complete && (
                <div className="round-result" aria-live="polite">
                  <div>
                    <CheckCheck size={19} />
                    <span>
                      {round.format === "matching"
                        ? "5 pairs completed"
                        : round.results[card.id] === "correct"
                          ? "Correct"
                          : round.results[card.id] === "almost"
                            ? "Hard"
                            : "Wrong"}
                    </span>
                    <small>
                      {scheduled
                        ? `${scheduled} ${scheduled === 1 ? "card" : "cards"} scheduled`
                        : "Schedule unchanged"}
                    </small>
                  </div>
                  <button className="button primary" onClick={() => next()}>
                    Next <ArrowRight size={17} />
                  </button>
                </div>
              )}
              {round.format === "matching" && scheduled < 5 && (
                <p className="helper">
                  {scheduled} scheduled {scheduled === 1 ? "card" : "cards"} ·{" "}
                  {5 - scheduled} extra practice. Only scheduled cards change
                  their review dates.
                </p>
              )}
            </>
          )}
          <div className="practice-footer">
            <span>
              {data.settings.mode === "mixed"
                ? "Mixed: singular weighted more often"
                : formatLabel(data.settings.mode)}
            </span>
            <button className="text-button" onClick={() => go("cards")}>
              Manage cards <ArrowUpRight size={14} />
            </button>
          </div>
        </section>
        <aside className="review-sidebar">
          <div className="stats-card">
            <span className="eyebrow">TODAY</span>
            <div className="stat-number">
              {today.toString().padStart(2, "0")}
            </div>
            <span className="muted">Cards reviewed</span>
            <div className="stat-line">
              <span>Due now</span>
              <strong>{due.length}</strong>
            </div>
            <div className="stat-line">
              <span>In this topic</span>
              <strong>{cards.length}</strong>
            </div>
          </div>
          <div className="format-info">
            <h3>Review formats</h3>
            <p>Singular: flip and rate your recall.</p>
            <p>Matching: connect five pairs.</p>
            <p>Multiple choice: choose from four answers.</p>
            {(!available.matching || !available.choice) && (
              <p className="helper">
                Matching needs 5 distinct pairs. Multiple choice needs 4. Mixed
                uses the formats available.
              </p>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
function Cards({
  data,
  commit,
  edit,
  setEdit,
  prefill,
  clearPrefill,
  notify,
}: {
  data: Data;
  commit: Commit;
  edit: string | null;
  setEdit: (id: string | null) => void;
  prefill: CardContent | null;
  clearPrefill: () => void;
  notify: (s: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [expanded, setExpanded] = useState(!!prefill),
    [archived, setArchived] = useState(false),
    [translateFrom, setTranslateFrom] = useState<"en" | "ar">("en"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [translated, setTranslated] = useState<CardContent | null>(prefill);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const items = searchCards(data, query, archived),
    card = data.cards.find((c) => c.id === edit);
  async function lookup() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await translate(query, translateFrom, controller.signal);
      if (controller.signal.aborted) return;
      const value = blankContent();
      value.front.headline = translateFrom === "en" ? result : query;
      value.back.headline = translateFrom === "en" ? query : result;
      setTranslated(value);
      setExpanded(true);
      setEdit(null);
    } catch (e) {
      if (!controller.signal.aborted) setError(message(e));
    } finally {
      if (request.current === controller) setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">COLLECTION</span>
          <h1>
            Cards{" "}
            <span className="heading-count">
              {data.cards.filter((c) => !c.archived).length}
            </span>
          </h1>
        </div>
      </div>
      <div className="search-input">
        <Search size={19} />
        <input
          aria-label="Search cards"
          placeholder="Search in English or Arabic"
          value={query}
          onChange={(e) => {
            request.current?.abort();
            setBusy(false);
            setQuery(e.target.value);
            setTranslateFrom(
              /[\u0600-\u06ff]/.test(e.target.value) ? "ar" : "en",
            );
          }}
        />
        {query && (
          <button
            className="icon-button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
          >
            <X size={17} />
          </button>
        )}
      </div>
      {query && (
        <div className="search-translate">
          <label>
            <span>Translate</span>
            <select
              aria-label="Search translation direction"
              value={translateFrom}
              onChange={(e) => {
                request.current?.abort();
                setBusy(false);
                setTranslateFrom(e.target.value as "en" | "ar");
              }}
            >
              <option value="en">English → Arabic</option>
              <option value="ar">Arabic → English</option>
            </select>
          </label>
          <button className="text-button" disabled={busy} onClick={lookup}>
            {busy ? "Translating…" : "Translate to new card"}
            <Languages size={16} />
          </button>
          <small>
            Text is sent to MyMemory only when you translate. Edit the result
            before saving.
          </small>
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <section className={`add-card-panel ${expanded ? "expanded" : ""}`}>
        <button
          className="add-card-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <span>
            <Plus size={20} />
            Add Card
          </span>
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
        {expanded && (
          <CardEditor
            key={translated ? JSON.stringify(translated) : "new"}
            initial={translated || blankContent()}
            onSave={(content) => {
              if (
                commit((d) => {
                  saveCard(d, content);
                })
              ) {
                setExpanded(false);
                setTranslated(null);
                clearPrefill();
                notify("Card saved.");
                return true;
              }
              return false;
            }}
            onCancel={() => setExpanded(false)}
            draftKey="memory:new-card"
            translated={!!translated}
          />
        )}
      </section>
      <div className="collection-toolbar">
        <span>
          {items.length} {items.length === 1 ? "card" : "cards"}
          {query ? " found" : ""}
        </span>
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>
      <div className="card-table">
        <div className="table-head">
          <span>FRONT</span>
          <span>BACK</span>
          <span>TYPE</span>
          <span />
        </div>
        {items.map((c) => (
          <button className="card-row" key={c.id} onClick={() => setEdit(c.id)}>
            <div>
              <SideText side={c.front} />
              <small>{c.front.description || c.topic}</small>
            </div>
            <div>
              <SideText side={c.back} />
              <small>{c.back.description}</small>
            </div>
            <div className="card-tags">
              {c.category && <span>{c.category}</span>}
              {c.partOfSpeech && <small>{c.partOfSpeech}</small>}
            </div>
            <Pencil size={16} />
          </button>
        ))}
      </div>
      {!items.length && (
        <div className="empty">
          <Layers size={25} />
          <h2>
            {query
              ? "No matching cards"
              : archived
                ? "No archived cards"
                : "No cards yet"}
          </h2>
          <p>
            {query
              ? "Add a card above or translate your search."
              : "Use Add Card to enter a front and back."}
          </p>
        </div>
      )}
      {card && (
        <Modal title="Edit card" close={() => setEdit(null)}>
          <CardEditor
            key={`${card.id}:${card.revision}`}
            initial={contentOf(card)}
            cardId={card.id}
            draftKey={`memory:edit:${card.id}:${card.revision}`}
            onSave={(content) => {
              if (
                commit((d) => {
                  const current = d.cards.find((c) => c.id === card.id);
                  if (current?.revision !== card.revision)
                    throw new Error(
                      "This card changed. Reopen it before saving.",
                    );
                  saveCard(d, content, card.id);
                })
              ) {
                setEdit(null);
                notify("Card saved. Changed content starts a new schedule.");
                return true;
              }
              return false;
            }}
            onCancel={() => setEdit(null)}
          />
          <button
            className="text-button archive-button"
            onClick={() => {
              if (commit((d) => archiveCard(d, card.id))) {
                setEdit(null);
                notify(card.archived ? "Card restored." : "Card archived.");
              }
            }}
          >
            <Archive size={16} />
            {card.archived ? "Restore card" : "Archive card"}
          </button>
        </Modal>
      )}
    </>
  );
}
function CardEditor({
  initial,
  onSave,
  onCancel,
  draftKey,
  translated = false,
  cardId,
}: {
  initial: CardContent;
  onSave: (c: CardContent) => boolean;
  onCancel: () => void;
  draftKey: string;
  translated?: boolean;
  cardId?: string;
}) {
  const draft = useDraft(draftKey, initial),
    [value, setValue] = useState(translated ? initial : draft.value),
    [error, setError] = useState(""),
    [translating, setTranslating] = useState(false),
    [suggestion, setSuggestion] = useState(translated);
  const translationRequest = useRef<AbortController | null>(null);
  useEffect(() => () => translationRequest.current?.abort(), []);
  function update(next: CardContent) {
    translationRequest.current?.abort();
    setTranslating(false);
    setValue(next);
    draft.update(next);
  }
  async function translateHeadline(source: "front" | "back") {
    translationRequest.current?.abort();
    const controller = new AbortController();
    translationRequest.current = controller;
    setTranslating(true);
    setError("");
    try {
      const result = await translate(value[source].headline, "en", controller.signal);
      if (controller.signal.aborted) return;
      const target = source === "front" ? "back" : "front";
      update({ ...value, [target]: { ...value[target], headline: result } });
      setSuggestion(true);
    } catch (e) {
      if (!controller.signal.aborted) setError(message(e));
    } finally {
      if (translationRequest.current === controller) setTranslating(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    translationRequest.current?.abort();
    if (!value.front.headline.trim() || !value.back.headline.trim()) {
      setError("Enter a headline on both sides.");
      return;
    }
    if (onSave(value)) draft.clear();
    else setError("Card could not be saved. Your edits are still here.");
  }
  return (
    <form className="card-editor" onSubmit={submit}>
      {suggestion && (
        <p className="translation-note">
          MyMemory suggestion. Edit either side before saving.
        </p>
      )}
      <div className="side-editors">
        {(["front", "back"] as const).map((side) => (
          <section className="side-editor" key={side}>
            <div className="side-heading">
              <span className="eyebrow">{side.toUpperCase()}</span>
              <select
                aria-label={`${side} designation`}
                value={value[side].designation}
                onChange={(e) =>
                  update({
                    ...value,
                    [side]: { ...value[side], designation: e.target.value },
                  })
                }
              >
                <option>Arabic word</option>
                <option>Explanation</option>
                <option>Other</option>
              </select>
            </div>
            <Field label={`${side === "front" ? "Front" : "Back"} headline`}>
              <input
                required
                dir="auto"
                className={
                  value[side].designation === "Arabic word"
                    ? "arabic-input"
                    : ""
                }
                value={value[side].headline}
                onChange={(e) =>
                  update({
                    ...value,
                    [side]: { ...value[side], headline: e.target.value },
                  })
                }
              />
            </Field>
            {value[side].designation === "Explanation" &&
              value[side === "front" ? "back" : "front"].designation === "Arabic word" && (
                <div>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={translating || !value[side].headline.trim()}
                    onClick={() => translateHeadline(side)}
                  >
                    <Languages size={16} />
                    {translating ? "Translating…" : "Translate to Arabic"}
                  </button>
                  <p className="helper">
                    Sends this English headline to MyMemory and fills the Arabic
                    headline. You can edit the result before saving.
                  </p>
                </div>
              )}
            <Field
              label={`${side === "front" ? "Front" : "Back"} description (optional)`}
            >
              <textarea
                rows={3}
                dir="auto"
                value={value[side].description}
                onChange={(e) =>
                  update({
                    ...value,
                    [side]: { ...value[side], description: e.target.value },
                  })
                }
              />
            </Field>
          </section>
        ))}
      </div>
      <div className="metadata-fields">
        <Field label="Topic">
          <input
            required
            value={value.topic}
            onChange={(e) => update({ ...value, topic: e.target.value })}
          />
        </Field>
        <Field label="Category (optional)">
          <select
            value={value.category}
            onChange={(e) =>
              update({
                ...value,
                category: e.target.value as CardContent["category"],
              })
            }
          >
            <option value="">None</option>
            <option>Vocab</option>
            <option>Grammar</option>
          </select>
        </Field>
        <Field label="Part of speech (optional)">
          <select
            value={value.partOfSpeech}
            onChange={(e) => update({ ...value, partOfSpeech: e.target.value })}
          >
            {[
              "",
              "Noun",
              "Verb",
              "Pronoun",
              "Adjective",
              "Adverb",
              "Preposition",
              "Conjunction",
              "Interjection",
              "Particle",
              "Determiner",
              "Numeral",
              "Phrase",
            ].map((p) => (
              <option value={p} key={p}>
                {p || "None"}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {cardId && (
        <p className="helper">
          Changing a card restarts its review schedule. Previous reviews stay in
          your activity.
        </p>
      )}
      {(error || draft.error) && (
        <p role="alert" className="inline-error">
          {error || draft.error}
        </p>
      )}
      <div className="form-actions">
        <button className="button secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="button primary" type="submit">
          Save card <Check size={16} />
        </button>
      </div>
    </form>
  );
}
function Tools({
  data,
  commit,
  useCard,
}: {
  data: Data;
  commit: Commit;
  useCard: (c: CardContent) => void;
}) {
  const [input, setInput] = useState(""),
    [output, setOutput] = useState(""),
    [from, setFrom] = useState<"en" | "ar">("en"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [editLink, setEditLink] = useState<"companion" | "audio" | null>(null),
    [link, setLink] = useState("");
  const [linkError, setLinkError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  function resetRequest() {
    request.current?.abort();
    setBusy(false);
    setOutput("");
    setError("");
  }
  async function lookup() {
    resetRequest();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const text = await translate(input, from, controller.signal);
      if (!controller.signal.aborted) setOutput(text);
    } catch (e) {
      if (!controller.signal.aborted) setError(message(e));
    } finally {
      if (request.current === controller) setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">REFERENCE</span>
          <h1>Tools</h1>
        </div>
      </div>
      <section className="translator panel">
        <div className="section-heading">
          <h2>
            <Languages size={21} />
            Translate
          </h2>
          <select
            aria-label="Translation direction"
            value={from}
            onChange={(e) => {
              resetRequest();
              setFrom(e.target.value as "en" | "ar");
            }}
          >
            <option value="en">English → Arabic</option>
            <option value="ar">Arabic → English</option>
          </select>
        </div>
        <div className="side-editors">
          <Field label={from === "en" ? "English text" : "Arabic text"}>
            <textarea
              rows={5}
              dir="auto"
              value={input}
              onChange={(e) => {
                resetRequest();
                setInput(e.target.value);
              }}
              placeholder="Enter a word or phrase"
            />
          </Field>
          <Field label="Translation (editable)">
            <textarea
              rows={5}
              dir="auto"
              value={output}
              onChange={(e) => setOutput(e.target.value)}
              placeholder="Translation"
            />
          </Field>
        </div>
        <div className="translator-actions">
          <button
            className="button primary"
            disabled={busy || !input.trim()}
            onClick={lookup}
          >
            {busy ? "Translating…" : "Translate"}
            <ArrowRight size={16} />
          </button>
          <button
            className="button secondary"
            disabled={!output.trim() || !input.trim()}
            onClick={() => {
              const c = blankContent();
              c.front.headline = from === "en" ? output : input;
              c.back.headline = from === "en" ? input : output;
              useCard(c);
            }}
          >
            Use in a card <Plus size={16} />
          </button>
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <p className="helper">
          MyMemory · free tier: 5,000 characters/day. Up to 500 UTF-8 bytes per
          request. Text is sent when you press Translate. Results may need
          correction.
        </p>
        <a
          className="external-link"
          href="https://mymemory.translated.net/"
          target="_blank"
          rel="noreferrer"
        >
          Open translation website <ArrowUpRight size={14} />
        </a>
      </section>
      <div className="resource-grid">
        {(
          [
            ["companion", "Book companion", BookOpen],
            ["audio", "Book audio player", Headphones],
          ] as const
        ).map(([key, title, Icon]) => (
          <section className="resource-card" key={key}>
            <span className="resource-icon">
              <Icon size={24} />
            </span>
            <h2>{title}</h2>
            <p>
              {data.links[key]
                ? new URL(data.links[key]).hostname
                : "No link added"}
            </p>
            <div className="resource-actions">
              {data.links[key] && (
                <a
                  className="button secondary"
                  href={data.links[key]}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open <ArrowUpRight size={16} />
                </a>
              )}
              <button
                className="text-button"
                onClick={() => {
                  setLinkError("");
                  setLink(data.links[key]);
                  setEditLink(key);
                }}
              >
                {data.links[key] ? "Edit link" : "Add link"}
                <Pencil size={15} />
              </button>
            </div>
          </section>
        ))}
      </div>
      {editLink && (
        <Modal
          title={
            editLink === "audio" ? "Book audio link" : "Book companion link"
          }
          close={() => setEditLink(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const checked = safeLink(link);
                if (
                  commit((d) => {
                    d.links[editLink] = checked;
                  })
                )
                  setEditLink(null);
                else setLinkError("Link could not be saved. Try again.");
              } catch (error) {
                setLinkError(message(error));
              }
            }}
          >
            <Field label="Website URL" hint="Leave empty to remove this link.">
              <input
                type="url"
                placeholder="https://"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
            </Field>
            {linkError && (
              <p className="inline-error" role="alert">
                {linkError}
              </p>
            )}
            <button className="button primary">
              Save link <Check size={16} />
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function More({
  data,
  commit,
  now,
  notify,
  cloudPanel,
}: {
  data: Data;
  commit: Commit;
  now: number;
  notify: (s: string) => void;
  cloudPanel: ReactNode;
}) {
  const days = sevenDays(data, new Date(now)),
    total = days.reduce((sum, d) => sum + d.count, 0),
    max = Math.max(1, ...days.map((d) => d.count));
  const [backup, setBackup] = useState<Data | null>(null),
    [error, setError] = useState("");
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ACTIVITY & PREFERENCES</span>
          <h1>More</h1>
        </div>
      </div>
      {cloudPanel}
      <div className="more-grid">
        <section className="panel activity">
          <div className="section-heading">
            <h2>Last 7 days</h2>
            <span className="muted">Home reviews</span>
          </div>
          <div className="activity-total">
            {total}
            <span>cards reviewed</span>
          </div>
          <div
            className="activity-chart"
            role="img"
            aria-label={days
              .map((d) => `${d.label}: ${d.count} cards`)
              .join(", ")}
          >
            {days.map((d, i) => (
              <div key={d.date}>
                <span>{d.count}</span>
                <div className="bar-track">
                  <div
                    className={i === 6 ? "today" : ""}
                    style={{
                      height: `${d.count ? Math.max(4, (d.count / max) * 100) : 2}%`,
                    }}
                  />
                </div>
                <span>{d.label}</span>
              </div>
            ))}
          </div>
          <p className="helper">
            Each rated card counts once. Completing a matching round counts
            five. Includes extra practice.
          </p>
        </section>
        <section className="panel preferences">
          <h2>Appearance</h2>
          <div className="theme-options">
            <button
              className={data.settings.theme === "light" ? "selected" : ""}
              aria-pressed={data.settings.theme === "light"}
              onClick={() =>
                commit((d) => {
                  d.settings.theme = "light";
                })
              }
            >
              <Sun size={21} />
              Light
            </button>
            <button
              className={data.settings.theme === "dark" ? "selected" : ""}
              aria-pressed={data.settings.theme === "dark"}
              onClick={() =>
                commit((d) => {
                  d.settings.theme = "dark";
                })
              }
            >
              <Moon size={21} />
              Dark
            </button>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={data.settings.motion}
              onChange={(e) =>
                commit((d) => {
                  d.settings.motion = e.target.checked;
                })
              }
            />
            Card motion
          </label>
          <p className="helper">
            Your device’s reduced-motion setting takes priority.
          </p>
        </section>
        <section className="panel backup">
          <h2>Data</h2>
          <p className="muted">
            Keep a portable backup of your cards and progress. Cloud saving status is shown above.
          </p>
          <div className="button-row">
            <button
              className="button secondary"
              onClick={() => download("memory-cards.json", exportBackup(data))}
            >
              <Download size={17} />
              Export cards & progress
            </button>
            <label className="button secondary file-button">
              <Upload size={17} />
              Restore backup
              <input
                aria-label="Restore backup file"
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  try {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 10000000)
                      throw new Error("Choose a backup under 10 MB.");
                    setBackup(parseBackup(await file.text()));
                    setError("");
                  } catch (e) {
                    setError(message(e));
                  }
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
      {backup && (
        <Modal title="Restore backup?" close={() => setBackup(null)}>
          <p>
            Replace this collection with {backup.cards.length} cards and{" "}
            {backup.reviews.length} reviews from the backup. This does not merge
            collections.
          </p>
          <div className="button-row">
            <button
              className="button secondary"
              onClick={() => setBackup(null)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              onClick={() => {
                if (
                  commit((d) => {
                    const revision = d.revision;
                    Object.assign(d, backup, { revision });
                  })
                ) {
                  setBackup(null);
                  notify("Backup restored.");
                }
              }}
            >
              Replace and restore
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
