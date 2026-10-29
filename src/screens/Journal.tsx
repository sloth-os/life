import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { rapportTier } from "../../shared/rules.ts";
import { SKILLS } from "../../shared/skills.ts";
import { LENS_IDS, LENSES, type LensId } from "../../shared/world.ts";
import { Avatar, LensTag } from "../components/ui.tsx";
import { canSpeak, speak } from "../lib/speech.ts";
import { answerRecall, answerReflection, go, openExpedition, revisitPerson, toggleMission } from "../state/actions.ts";
import { useGame } from "../state/store.ts";
import type { JournalInsight } from "../state/types.ts";

type Tab = "insights" | "review" | "phrases" | "people" | "missions" | "reflections" | "places";

const date = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <p>{children}</p>
      <button type="button" className="btn btn--primary" onClick={() => go("world")}>
        Go exploring
      </button>
    </div>
  );
}

function Review({ due }: { due: JournalInsight[] }) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const card = due[index];
  if (!card) {
    return <div className="empty"><p>{due.length ? "All caught up — nice work! 🎉" : "Nothing to review right now. New insights become recall cards; review them over the coming days to make them stick."}</p></div>;
  }
  const { quiz } = card.insight;
  const correct = picked === quiz.answerIndex;
  return (
    <div className="recall" data-testid="recall">
      <p className="eyebrow">
        Card {index + 1} of {due.length} · from {card.npcName}, {card.city ?? card.placeName}
      </p>
      <h2>{quiz.question}</h2>
      <div className="recall__options">
        {quiz.options.map((option, i) => (
          <button
            key={i}
            type="button"
            className={`recall__option${picked !== null && i === quiz.answerIndex ? " is-correct" : ""}${picked === i && !correct ? " is-wrong" : ""}`}
            disabled={picked !== null}
            onClick={() => setPicked(i)}
          >
            {option}
          </button>
        ))}
      </div>
      {picked !== null ? (
        <div className="recall__feedback" role="status">
          <p>
            <strong>{correct ? "Correct! +5 XP" : "Not quite."}</strong> {card.insight.fact}
          </p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              answerRecall(card.key, correct);
              setPicked(null);
              setIndex(index + 1);
            }}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function JournalScreen() {
  const game = useGame();
  const [tab, setTab] = useState<Tab>("insights");
  const [lens, setLens] = useState<LensId | "all">("all");
  const { insights, phrases, missions, reflections } = game.journal;
  // Freeze the review queue each time the tab changes, so answering a card doesn't reshuffle it.
  const due = useMemo(() => insights.filter((j) => j.recall.dueAt <= Date.now()), [tab]);
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "insights", label: "Insights", count: insights.length },
    { id: "review", label: "Review", count: due.length },
    { id: "phrases", label: "Phrasebook", count: phrases.length },
    { id: "people", label: "People", count: game.people.length },
    { id: "missions", label: "Missions", count: missions.filter((m) => !m.doneAt).length },
    { id: "reflections", label: "Reflections", count: reflections.length },
    { id: "places", label: "Places", count: game.atlas.length },
  ];
  const shown = insights.filter((j) => lens === "all" || j.insight.lens === lens);

  return (
    <div className="page journal">
      <header className="page-head">
        <h1>Field Journal</h1>
        <p className="muted">
          {insights.length} insights · {phrases.length} phrases · {game.people.length} people · {new Set(game.atlas.map((a) => a.country).filter(Boolean)).size} countries
        </p>
      </header>
      <div className="tabs" role="tablist" aria-label="Journal sections">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "is-active" : ""} onClick={() => setTab(t.id)}>
            {t.label}
            {t.count ? <span className="count">{t.count}</span> : null}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "insights" ? (
          insights.length === 0 ? (
            <Empty>Insights appear here as locals trust you enough to share what they know.</Empty>
          ) : (
            <>
              <div className="filter-chips" role="group" aria-label="Filter by lens">
                <button type="button" className={lens === "all" ? "is-on" : ""} onClick={() => setLens("all")}>
                  All
                </button>
                {LENS_IDS.map((l) => (
                  <button key={l} type="button" className={lens === l ? "is-on" : ""} onClick={() => setLens(l)}>
                    {LENSES[l].icon} {LENSES[l].name} ({insights.filter((j) => j.insight.lens === l).length})
                  </button>
                ))}
              </div>
              <ul className="card-grid">
                {shown.map((j) => (
                  <li key={j.key} className="card insight-card" style={{ "--lens-color": LENSES[j.insight.lens].color } as CSSProperties}>
                    <LensTag lens={j.insight.lens} />
                    <h3>{j.insight.title}</h3>
                    <p>{j.insight.fact}</p>
                    <p className="muted small">
                      From {j.npcName} · {j.placeName}
                      {j.city ? `, ${j.city}` : ""} · {date(j.foundAt)}
                    </p>
                    {j.sources.length ? (
                      <p className="small">
                        Sources:{" "}
                        {j.sources.map((s, i) => (
                          <span key={s.id}>
                            {i ? ", " : ""}
                            {s.url ? (
                              <a href={s.url} target="_blank" rel="noreferrer">
                                {s.title}
                              </a>
                            ) : (
                              s.title
                            )}{" "}
                            <span className="muted">({s.attribution})</span>
                          </span>
                        ))}
                      </p>
                    ) : (
                      <p className="muted small">General knowledge shared by a local — worth double-checking.</p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )
        ) : null}

        {tab === "review" ? <Review due={due} /> : null}

        {tab === "phrases" ? (
          phrases.length === 0 ? (
            <Empty>Locals sometimes teach you words in their language. They'll collect here.</Empty>
          ) : (
            <ul className="card-grid">
              {phrases.map((p) => (
                <li key={p.text} className="card phrase-card">
                  <p className="phrase-card__text">{p.text}</p>
                  <p>{p.meaning}</p>
                  <p className="muted small">
                    {p.language} · from {p.from}
                    {p.city ? ` in ${p.city}` : ""}
                  </p>
                  {canSpeak() ? (
                    <button type="button" className="icon-btn" aria-label={`Hear “${p.text}”`} onClick={() => speak(p.text)}>
                      🔊
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "people" ? (
          game.people.length === 0 ? (
            <Empty>Everyone you talk with is remembered here — and they'll remember you.</Empty>
          ) : (
            <ul className="card-grid">
              {game.people.map((p) => (
                <li key={p.key} className="card person-card">
                  <div className="person-card__head">
                    <Avatar name={p.npc.name} hue={p.npc.hue} />
                    <div>
                      <h3>{p.npc.name}</h3>
                      <p className="muted small">
                        {p.npc.role} · {[p.city, p.country].filter(Boolean).join(", ")}
                      </p>
                    </div>
                  </div>
                  <p>
                    <strong>{rapportTier(p.lastRapport)}</strong> · rapport {Math.round(p.lastRapport)} · {p.visits} visit{p.visits === 1 ? "" : "s"}
                  </p>
                  {p.memory ? <p className="memory">“{p.memory}”</p> : null}
                  <button type="button" className="btn btn--small" onClick={() => revisitPerson(p.key)} disabled={!game.expeditions.some((e) => e.id === p.expeditionId)}>
                    Visit again
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "missions" ? (
          missions.length === 0 ? (
            <Empty>After each conversation your mentor suggests a small real-world mission. Try them with real people!</Empty>
          ) : (
            <ul className="missions">
              {missions.map((m) => (
                <li key={m.id} className={m.doneAt ? "is-done" : ""}>
                  <label>
                    <input type="checkbox" checked={Boolean(m.doneAt)} onChange={() => toggleMission(m.id)} />
                    <span>
                      <strong>{m.title}</strong> <span className="muted small">· {SKILLS[m.skill].icon} {SKILLS[m.skill].name}{m.doneAt ? " · done, +20 XP" : ""}</span>
                      <br />
                      {m.description}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "reflections" ? (
          reflections.length === 0 ? (
            <Empty>Your self-assessments and reflections will build up here over time.</Empty>
          ) : (
            <ul className="reflections">
              {reflections.map((r) => (
                <li key={r.id} className="card">
                  <p className="muted small">
                    {date(r.at)} · with {r.npcName}
                    {r.city ? ` in ${r.city}` : ""} · you rated it {r.selfRating}/5
                  </p>
                  <h3>{r.headline}</h3>
                  {r.selfNote ? <p>Your note: “{r.selfNote}”</p> : null}
                  <p>
                    <em>{r.question}</em>
                  </p>
                  <textarea defaultValue={r.answer ?? ""} rows={2} aria-label="Your reflection" placeholder="Write a few words…" onBlur={(e) => answerReflection(r.id, e.target.value.trim())} />
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "places" ? (
          game.atlas.length === 0 ? (
            <Empty>Every place you visit gets a stamp in your atlas.</Empty>
          ) : (
            <ul className="places">
              {game.atlas.map((a) => (
                <li key={a.expeditionId} className="card place-card">
                  <div>
                    <h3>{a.title}</h3>
                    <p className="muted small">
                      {[a.city, a.country].filter(Boolean).join(", ") || a.destination.label} · {date(a.visitedAt)}
                    </p>
                    <p className="tags">
                      {a.lenses.map((l) => (
                        <LensTag key={l} lens={l} />
                      ))}
                    </p>
                  </div>
                  <button type="button" className="btn btn--small" onClick={() => openExpedition(a.expeditionId)} disabled={!game.expeditions.some((e) => e.id === a.expeditionId)}>
                    Return
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </div>
  );
}
