import { useState, type CSSProperties } from "react";
import { SKILL_IDS, SKILLS } from "../../shared/skills.ts";
import { LENSES } from "../../shared/world.ts";
import { Postcard } from "../components/Postcard.tsx";
import { Avatar, MoveChips } from "../components/ui.tsx";
import { answerReflection, currentExpedition, finishDebrief, go } from "../state/actions.ts";
import { useGame } from "../state/store.ts";

const RATING_LABELS = ["Rough", "Shaky", "Okay", "Good", "Great"];

function ScoreDots({ score }: { score: number | null }) {
  if (score === null) return <span className="muted small">not this time</span>;
  return (
    <span className="score-dots" aria-label={`${score} out of 4`}>
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
        <p>No debrief to show.</p>
        <button type="button" className="btn btn--primary" onClick={() => go("world")}>
          World map
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
            Mentor debrief · {result.npcName} at {result.placeName}
          </p>
          <h1>{debrief.headline}</h1>
          <p className="lede">{debrief.summary}</p>
          <p className="row">
            <span className={`pill${debrief.goalAchieved ? " pill--good" : ""}`}>🎯 {debrief.goalAchieved ? "Goal achieved" : "Goal not reached — yet"}</span>
            <span className="pill pill--xp">+{result.xp.total} XP</span>
            {result.rankUp ? <span className="pill pill--good">🏅 New rank: {result.rankUp}</span> : null}
          </p>
        </div>
      </header>

      <div className="debrief-grid">
        <section className="card card--wide growth" aria-labelledby="growth-title">
          <p className="eyebrow">
            {SKILLS[debrief.growth.skill].icon} One thing to try · {SKILLS[debrief.growth.skill].name}
          </p>
          <h2 id="growth-title">{debrief.growth.tip}</h2>
          {debrief.growth.original ? (
            <div className="rewrite">
              <p>
                <span className="rewrite__label">You said</span>“{debrief.growth.original}”
              </p>
              <p>
                <span className="rewrite__label rewrite__label--try">Try</span>“{debrief.growth.rewrite}”
              </p>
            </div>
          ) : (
            <p className="rewrite">
              <span className="rewrite__label rewrite__label--try">Try</span>“{debrief.growth.rewrite}”
            </p>
          )}
        </section>

        <section className="card" aria-labelledby="scores-title">
          <h2 id="scores-title">Your skills in this conversation</h2>
          <ul className="score-list">
            {SKILL_IDS.map((id) => {
              const score = debrief.scores[id];
              const evidence = debrief.evidence.filter((e) => e.skill === id);
              return (
                <li key={id} className={score === null ? "is-null" : ""}>
                  <div className="score-row">
                    <span>
                      {SKILLS[id].icon} {SKILLS[id].name}
                    </span>
                    <ScoreDots score={score} />
                  </div>
                  {score !== null ? <p className="muted small">{SKILLS[id].rubric[score]}</p> : null}
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
          <h2 id="landed-title">How your words landed</h2>
          <p className="muted small">What {name} privately thought after each of your lines.</p>
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
          <h2 id="strength-title">What worked</h2>
          <ul className="bullets">
            {debrief.strengths.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <h3>Self-check</h3>
          <p>
            You rated yourself <strong>{result.selfRating}/5</strong> ({RATING_LABELS[result.selfRating - 1]}). {debrief.calibration}
          </p>
        </section>

        <section className="card" aria-labelledby="xp-title">
          <h2 id="xp-title">Rewards</h2>
          <ul className="xp-parts">
            {result.xp.parts.map((p) => (
              <li key={p.label}>
                <span>{p.label}</span>
                <strong>+{p.xp}</strong>
              </li>
            ))}
          </ul>
          {result.levelUps.map((l) => (
            <p key={l.skill} className="level-up">
              {SKILLS[l.skill].icon} {SKILLS[l.skill].name} is now <strong>{l.level}</strong>
            </p>
          ))}
          {result.insights.length ? (
            <>
              <h3>Insights for your journal</h3>
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
            <p className="eyebrow">Souvenir</p>
            <h2 id="postcard-title">Your postcard from {expedition.locality.city ?? expedition.destination.label}</h2>
            <Postcard
              expeditionId={expedition.id}
              label={expedition.destination.label}
              country={expedition.locality.country ?? expedition.destination.country}
              lenses={[...new Set(expedition.npcs.map((n) => n.lens))]}
            />
          </section>
        ) : null}

        <section className="card mission-card" aria-labelledby="mission-title">
          <p className="eyebrow">Field mission · try it in real life</p>
          <h2 id="mission-title">{debrief.fieldMission.title}</h2>
          <p>{debrief.fieldMission.description}</p>
          <p className="muted small">Added to your journal. Tick it off when you've tried it — real conversations are the point.</p>
        </section>

        <section className="card" aria-labelledby="reflect-title">
          <p className="eyebrow">Reflect</p>
          <h2 id="reflect-title">{debrief.reflectionQuestion}</h2>
          <textarea
            value={answer}
            rows={3}
            maxLength={600}
            onChange={(e) => {
              setAnswer(e.target.value);
              setSaved(false);
            }}
            aria-label="Your reflection"
            placeholder="A few honest words are enough…"
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
            {saved ? "Saved ✓" : "Save to journal"}
          </button>
        </section>
      </div>

      <div className="row debrief-actions">
        <button type="button" className="btn btn--primary" onClick={() => finishDebrief()} data-testid="debrief-done">
          Back to {expedition?.locality.city ?? "the expedition"}
        </button>
        <button type="button" className="btn" onClick={() => go("compass")}>
          See my Compass
        </button>
      </div>
    </div>
  );
}
