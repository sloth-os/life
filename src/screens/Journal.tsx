import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { rapportTier } from "../../shared/rules.ts";
import { SKILLS } from "../../shared/skills.ts";
import { LENS_IDS, LENSES, type LensId } from "../../shared/world.ts";
import { Avatar, LensTag } from "../components/ui.tsx";
import { Postcard } from "../components/Postcard.tsx";
import { PronounceButton } from "../components/Pronounce.tsx";
import { canSpeak, speak } from "../lib/speech.ts";
import { answerRecall, answerReflection, go, openExpedition, revisitPerson, toggleMission } from "../state/actions.ts";
import { useGame } from "../state/store.ts";
import type { JournalInsight } from "../state/types.ts";
import { LANG_TAGS, lang, lensName, plural, skillName, t, tierName, type MessageKey } from "../i18n/index.ts";

type Tab = "insights" | "review" | "phrases" | "people" | "missions" | "reflections" | "places";

const date = (at: number) => new Date(at).toLocaleDateString(LANG_TAGS[lang()], { month: "short", day: "numeric" });

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <p>{children}</p>
      <button type="button" className="btn btn--primary" onClick={() => go("world")}>
        {t("journal.goExploring")}
      </button>
    </div>
  );
}

function Review({ due }: { due: JournalInsight[] }) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const card = due[index];
  if (!card) {
    return <div className="empty"><p>{due.length ? t("journal.caughtUp") : t("journal.nothingToReview")}</p></div>;
  }
  const { quiz } = card.insight;
  const correct = picked === quiz.answerIndex;
  return (
    <div className="recall" data-testid="recall">
      <p className="eyebrow">
        {t("journal.card", { n: index + 1, total: due.length, name: card.npcName, place: card.city ?? card.placeName })}
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
            <strong>{correct ? t("journal.correct") : t("journal.notQuite")}</strong> {card.insight.fact}
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
            {t("common.next")}
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
  const tabs: { id: Tab; label: MessageKey; count?: number }[] = [
    { id: "insights", label: "journal.tabInsights", count: insights.length },
    { id: "review", label: "journal.tabReview", count: due.length },
    { id: "phrases", label: "journal.tabPhrases", count: phrases.length },
    { id: "people", label: "journal.tabPeople", count: game.people.length },
    { id: "missions", label: "journal.tabMissions", count: missions.filter((m) => !m.doneAt).length },
    { id: "reflections", label: "journal.tabReflections", count: reflections.length },
    { id: "places", label: "journal.tabPlaces", count: game.atlas.length },
  ];
  const shown = insights.filter((j) => lens === "all" || j.insight.lens === lens);

  return (
    <div className="page journal">
      <header className="page-head">
        <h1>{t("journal.title")}</h1>
        <p className="muted">
          {t("journal.counts", { insights: insights.length, phrases: phrases.length, people: game.people.length, countries: new Set(game.atlas.map((a) => a.country).filter(Boolean)).size })}
        </p>
      </header>
      <div className="tabs" role="tablist" aria-label={t("journal.sections")}>
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>
            {t(item.label)}
            {item.count ? <span className="count">{item.count}</span> : null}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "insights" ? (
          insights.length === 0 ? (
            <Empty>{t("journal.emptyInsights")}</Empty>
          ) : (
            <>
              <div className="filter-chips" role="group" aria-label={t("journal.filterByLens")}>
                <button type="button" className={lens === "all" ? "is-on" : ""} onClick={() => setLens("all")}>
                  {t("journal.all")}
                </button>
                {LENS_IDS.map((l) => (
                  <button key={l} type="button" className={lens === l ? "is-on" : ""} onClick={() => setLens(l)}>
                    {LENSES[l].icon} {lensName(l)} ({insights.filter((j) => j.insight.lens === l).length})
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
                      {t("journal.from", { name: j.npcName, place: j.placeName })}
                      {j.city ? `, ${j.city}` : ""} · {date(j.foundAt)}
                    </p>
                    {j.sources.length ? (
                      <p className="small">
                        {t("journal.sources")}{" "}
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
                      <p className="muted small">{t("journal.generalKnowledge")}</p>
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
            <Empty>{t("journal.emptyPhrases")}</Empty>
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
                  <PronounceButton phrase={p.text} language={p.language} meaning={p.meaning} />
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "people" ? (
          game.people.length === 0 ? (
            <Empty>{t("journal.emptyPeople")}</Empty>
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
                    <strong>{tierName(rapportTier(p.lastRapport))}</strong> · {t("journal.rapport", { value: Math.round(p.lastRapport) })} · {plural(p.visits, "journal.visitOne", "journal.visits")}
                  </p>
                  {p.memory ? <p className="memory">“{p.memory}”</p> : null}
                  <button type="button" className="btn btn--small" onClick={() => revisitPerson(p.key)} disabled={!game.expeditions.some((e) => e.id === p.expeditionId)}>
                    {t("journal.visitAgain")}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "missions" ? (
          missions.length === 0 ? (
            <Empty>{t("journal.emptyMissions")}</Empty>
          ) : (
            <ul className="missions">
              {missions.map((m) => (
                <li key={m.id} className={m.doneAt ? "is-done" : ""}>
                  <label>
                    <input type="checkbox" checked={Boolean(m.doneAt)} onChange={() => toggleMission(m.id)} />
                    <span>
                      <strong>{m.title}</strong> <span className="muted small">· {SKILLS[m.skill].icon} {skillName(m.skill)}{m.doneAt ? ` · ${t("journal.missionDone")}` : ""}</span>
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
            <Empty>{t("journal.emptyReflections")}</Empty>
          ) : (
            <ul className="reflections">
              {reflections.map((r) => (
                <li key={r.id} className="card">
                  <p className="muted small">
                    {date(r.at)} · {t("journal.with", { name: r.npcName })}
                    {r.city ? ` ${t("journal.in", { place: r.city })}` : ""} · {t("journal.youRated", { rating: r.selfRating })}
                  </p>
                  <h3>{r.headline}</h3>
                  {r.selfNote ? <p>{t("journal.yourNote", { note: r.selfNote })}</p> : null}
                  <p>
                    <em>{r.question}</em>
                  </p>
                  <textarea defaultValue={r.answer ?? ""} rows={2} aria-label={t("debrief.reflectionLabel")} placeholder={t("journal.writeFew")} onBlur={(e) => answerReflection(r.id, e.target.value.trim())} />
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "places" ? (
          game.atlas.length === 0 ? (
            <Empty>{t("journal.emptyPlaces")}</Empty>
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
                    <Postcard expeditionId={a.expeditionId} label={a.destination.label} country={a.country ?? a.destination.country} lenses={a.lenses} compact />
                  </div>
                  <button type="button" className="btn btn--small" onClick={() => openExpedition(a.expeditionId)} disabled={!game.expeditions.some((e) => e.id === a.expeditionId)}>
                    {t("journal.return")}
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
