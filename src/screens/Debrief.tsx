import { useState, type CSSProperties } from "react";
import { MENTOR_QUESTIONS_MAX } from "../../shared/schemas.ts";
import { SKILL_IDS, SKILLS } from "../../shared/skills.ts";
import { LENSES } from "../../shared/world.ts";
import { Postcard } from "../components/Postcard.tsx";
import { Avatar, MoveChips, Spinner } from "../components/ui.tsx";
import { answerReflection, askMentor, currentExpedition, finishDebrief, go } from "../state/actions.ts";
import { useGame } from "../state/store.ts";
import type { DebriefResult } from "../state/types.ts";
import { levelName, rankName, skillName, skillRubric, t, xpLabel, type MessageKey } from "../i18n/index.ts";

const RATING_LABELS: MessageKey[] = ["rating.1", "rating.2", "rating.3", "rating.4", "rating.5"];

function ScoreDots({ score }: { score: number | null }) {
  if (score === null) return <span className="muted small">{t("debrief.notThisTime")}</span>;
  return (
    <span className="score-dots" aria-label={t("debrief.scoreAria", { score })}>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={i < score ? "on" : ""} />
      ))}
    </span>
  );
}

export function DebriefScreen() {
  const game = useGame();
  const result = game.active.debrief;
  const expedition = currentExpedition(game);
  const reflection = game.journal.reflections[0];
  const [answer, setAnswer] = useState(reflection?.answer ?? "");
  const [saved, setSaved] = useState(false);

  if (!result) {
    return (
      <div className="page">
        <p>{t("debrief.none")}</p>
        <button type="button" className="btn btn--primary" onClick={() => go("world")}>
          {t("expedition.worldMap")}
        </button>
      </div>
    );
  }

  const { debrief } = result;
  const npc = expedition?.npcs.find((n) => n.id === result.npcId);
  const name = result.npcName.split(" ")[0];
  const landed = result.transcript.flatMap((entry, i) => {
    if (entry.speaker !== "player") return [];
    const reply = result.transcript[i + 1];
    return reply?.speaker === "npc" ? [{ said: entry, reply }] : [];
  });

  return (
    <div className="page debrief" data-testid="debrief">
      <header className="debrief-head">
        {npc ? <Avatar name={result.npcName} hue={npc.hue} size={56} /> : null}
        <div>
          <p className="eyebrow">
            {t("debrief.eyebrow", { name: result.npcName, place: result.placeName })}
          </p>
          <h1>{debrief.headline}</h1>
          <p className="lede">{debrief.summary}</p>
          <p className="row">
            <span className={`pill${debrief.goalAchieved ? " pill--good" : ""}`}>🎯 {debrief.goalAchieved ? t("debrief.goalAchieved") : t("debrief.goalNotYet")}</span>
            <span className="pill pill--xp">+{result.xp.total} XP</span>
            {result.rankUp ? <span className="pill pill--good">🏅 {t("debrief.newRank", { rank: rankName(result.rankUp) })}</span> : null}
          </p>
        </div>
      </header>

      <div className="debrief-grid">
        <section className="card card--wide growth" aria-labelledby="growth-title">
          <p className="eyebrow">
            {SKILLS[debrief.growth.skill].icon} {t("debrief.oneThing", { skill: skillName(debrief.growth.skill) })}
          </p>
          <h2 id="growth-title">{debrief.growth.tip}</h2>
          {debrief.growth.original ? (
            <div className="rewrite">
              <p>
                <span className="rewrite__label">{t("debrief.youSaid")}</span>“{debrief.growth.original}”
              </p>
              <p>
                <span className="rewrite__label rewrite__label--try">{t("debrief.try")}</span>“{debrief.growth.rewrite}”
              </p>
            </div>
          ) : (
            <p className="rewrite">
              <span className="rewrite__label rewrite__label--try">{t("debrief.try")}</span>“{debrief.growth.rewrite}”
            </p>
          )}
        </section>

        <section className="card" aria-labelledby="scores-title">
          <h2 id="scores-title">{t("debrief.skillsTitle")}</h2>
          <ul className="score-list">
            {SKILL_IDS.map((id) => {
              const score = debrief.scores[id];
              const evidence = debrief.evidence.filter((e) => e.skill === id);
              return (
                <li key={id} className={score === null ? "is-null" : ""}>
                  <div className="score-row">
                    <span>
                      {SKILLS[id].icon} {skillName(id)}
                    </span>
                    <ScoreDots score={score} />
                  </div>
                  {score !== null ? <p className="muted small">{skillRubric(id)[score]}</p> : null}
                  {evidence.map((e, i) => (
                    <blockquote key={i} className={e.positive ? "evidence evidence--good" : "evidence evidence--watch"}>
                      “{e.quote}”<span>{e.note}</span>
                    </blockquote>
                  ))}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card" aria-labelledby="landed-title">
          <h2 id="landed-title">{t("debrief.landedTitle")}</h2>
          <p className="muted small">{t("debrief.landedText", { name: name ?? "" })}</p>
          <ol className="landed">
            {landed.map(({ said, reply }, i) => (
              <li key={i}>
                <p className="landed__said">“{said.text}”</p>
                <MoveChips moves={said.moves ?? []} />
                <p className="landed__thought">
                  <span className={reply.rapportDelta >= 0 ? "delta up" : "delta down"}>{reply.rapportDelta >= 0 ? `+${reply.rapportDelta}` : reply.rapportDelta}</span>
                  {reply.innerThought ? <em>{reply.innerThought}</em> : null}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="card" aria-labelledby="strength-title">
          <h2 id="strength-title">{t("debrief.whatWorked")}</h2>
          <ul className="bullets">
            {debrief.strengths.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <h3>{t("debrief.selfCheck")}</h3>
          <p>
            {t("debrief.youRated", { rating: result.selfRating, label: t(RATING_LABELS[result.selfRating - 1]!) })} {debrief.calibration}
          </p>
        </section>

        <section className="card" aria-labelledby="xp-title">
          <h2 id="xp-title">{t("debrief.rewards")}</h2>
          <ul className="xp-parts">
            {result.xp.parts.map((p) => (
              <li key={p.label}>
                <span>{xpLabel(p.label)}</span>
                <strong>+{p.xp}</strong>
              </li>
            ))}
          </ul>
          {result.levelUps.map((l) => (
            <p key={l.skill} className="level-up">
              {SKILLS[l.skill].icon} {t("debrief.levelUp", { skill: skillName(l.skill) })} <strong>{levelName(l.level)}</strong>
            </p>
          ))}
          {result.insights.length ? (
            <>
              <h3>{t("debrief.insights")}</h3>
              <ul className="mini-insights">
                {result.insights.map((insight) => (
                  <li key={insight.id} style={{ "--lens-color": LENSES[insight.lens].color } as CSSProperties}>
                    <span aria-hidden="true">{LENSES[insight.lens].icon}</span> <strong>{insight.title}</strong> — {insight.fact}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        {expedition && (game.ui.config?.features.postcards || game.atlas.some((a) => a.expeditionId === expedition.id)) ? (
          <section className="card" aria-labelledby="postcard-title">
            <p className="eyebrow">{t("debrief.souvenir")}</p>
            <h2 id="postcard-title">{t("debrief.postcardFrom", { place: expedition.locality.city ?? expedition.destination.label })}</h2>
            <Postcard
              expeditionId={expedition.id}
              label={expedition.destination.label}
              country={expedition.locality.country ?? expedition.destination.country}
              lenses={[...new Set(expedition.npcs.map((n) => n.lens))]}
            />
          </section>
        ) : null}

        {result.shared ? (
          <p className={`notice small${result.shared.status === "failed" ? " notice--error" : ""}`} role="status" data-testid="shared-with-class">
            {result.shared.status === "sent"
              ? `🎓 ${t("debrief.shared", { className: result.shared.className })}`
              : `🎓 ${t("debrief.notShared", { className: result.shared.className })}`}
          </p>
        ) : null}

        <MentorChat result={result} />

        <section className="card mission-card" aria-labelledby="mission-title">
          <p className="eyebrow">{t("debrief.mission")}</p>
          <h2 id="mission-title">{debrief.fieldMission.title}</h2>
          <p>{debrief.fieldMission.description}</p>
          <p className="muted small">{t("debrief.missionAdded")}</p>
        </section>

        <section className="card" aria-labelledby="reflect-title">
          <p className="eyebrow">{t("debrief.reflect")}</p>
          <h2 id="reflect-title">{debrief.reflectionQuestion}</h2>
          <textarea
            value={answer}
            rows={3}
            maxLength={600}
            onChange={(e) => {
              setAnswer(e.target.value);
              setSaved(false);
            }}
            aria-label={t("debrief.reflectionLabel")}
            placeholder={t("debrief.reflectionPlaceholder")}
          />
          <button
            type="button"
            className="btn btn--small"
            disabled={!answer.trim() || !reflection}
            onClick={() => {
              if (reflection) answerReflection(reflection.id, answer.trim());
              setSaved(true);
            }}
          >
            {saved ? t("debrief.saved") : t("debrief.saveToJournal")}
          </button>
        </section>
      </div>

      <div className="row debrief-actions">
        <button type="button" className="btn btn--primary" onClick={() => finishDebrief()} data-testid="debrief-done">
          {expedition?.locality.city ? t("debrief.backTo", { place: expedition.locality.city }) : t("debrief.backToExpedition")}
        </button>
        <button type="button" className="btn" onClick={() => go("compass")}>
          {t("debrief.seeCompass")}
        </button>
      </div>
    </div>
  );
}

/** "Explain the debrief": follow-up questions to the mentor, answered from this conversation. */
function MentorChat({ result }: { result: DebriefResult }) {
  const { ui, active } = useGame();
  const [draft, setDraft] = useState("");
  const qa = result.qa ?? [];
  const asking = ui.mentorAsking;
  const left = MENTOR_QUESTIONS_MAX - qa.length - (asking ? 1 : 0);
  // Questions need the conversation itself, which is kept until you leave the debrief.
  const available = active.encounter?.id === result.encounterId;
  const starters = qa.length
    ? (qa.at(-1)?.followUps ?? [])
    : [t("ask.whyScore", { skill: skillName(result.debrief.growth.skill).toLowerCase() }), t("ask.differently"), t("ask.didWell")];
  if (!available && qa.length === 0) return null;
  const ask = (question: string) => {
    setDraft("");
    void askMentor(question);
  };
  return (
    <section className="card mentor-chat" aria-labelledby="ask-title" data-testid="mentor-chat">
      <p className="eyebrow">{t("ask.eyebrow")}</p>
      <h2 id="ask-title">{t("ask.title")}</h2>
      <ol className="qa">
        {qa.map((item, i) => (
          <li key={i}>
            <p className="qa__q">{item.question}</p>
            <p className="qa__a" data-testid="qa-answer">
              {item.answer}
            </p>
          </li>
        ))}
        {asking ? (
          <li aria-busy="true">
            <p className="qa__q">{asking.question}</p>
            <p className="qa__a">{asking.answer || <Spinner label={t("ask.thinking")} />}</p>
          </li>
        ) : null}
      </ol>
      {available && left > 0 ? (
        <>
          <div className="chips">
            {starters.map((starter) => (
              <button key={starter} type="button" className="chip" disabled={Boolean(asking)} onClick={() => ask(starter)}>
                {starter}
              </button>
            ))}
          </div>
          <form
            className="row ask-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) ask(draft);
            }}
          >
            <input value={draft} maxLength={400} onChange={(e) => setDraft(e.target.value)} placeholder={t("ask.placeholder")} aria-label={t("ask.label")} data-testid="ask-input" />
            <button type="submit" className="btn btn--small" disabled={!draft.trim() || Boolean(asking)} data-testid="ask-btn">
              {t("ask.ask")}
            </button>
          </form>
          <p className="muted small">{left === 1 ? t("ask.leftOne") : t("ask.left", { count: left })}</p>
        </>
      ) : available ? (
        <p className="muted small">{t("ask.done")}</p>
      ) : null}
    </section>
  );
}
