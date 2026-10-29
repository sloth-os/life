import { useState, type FormEvent } from "react";
import { SKILL_IDS, SKILLS, type SkillId } from "../../shared/skills.ts";
import { Logo } from "../components/ui.tsx";
import { completeOnboarding, go, submitAccessCode } from "../state/actions.ts";
import { useGame } from "../state/store.ts";

export function ModeBadges() {
  const { config } = useGame().ui;
  if (!config) return null;
  return (
    <p className="mode-badges">
      <span className={`mode mode--${config.aiMode}`}>{config.aiMode === "claude" ? "AI: Claude" : "AI: Demo (scripted)"}</span>
      <span className={`mode mode--${config.mapsMode}`}>{config.mapsMode === "google" ? "Map: Google Maps" : "Map: Open map"}</span>
    </p>
  );
}

export function TitleScreen() {
  const game = useGame();
  return (
    <div className="title-screen">
      <div className="title-card">
        <Logo size={76} />
        <h1>Common Ground</h1>
        <p className="tagline">Explore the real world. Meet its people. Find common ground.</p>
        <p className="lede">
          Travel anywhere on the map, talk with AI locals grounded in real places, and grow six real-world social skills — with a mentor who shows you exactly what
          worked and what to try next.
        </p>
        <div className="cta-row">
          {game.player ? (
            <button type="button" className="btn btn--primary btn--lg" onClick={() => go("world")}>
              Continue as {game.player.name}
            </button>
          ) : (
            <button type="button" className="btn btn--primary btn--lg" onClick={() => go("onboarding")}>
              Begin your journey
            </button>
          )}
        </div>
        <ol className="how">
          <li>
            <span aria-hidden="true">🌍</span>
            <strong>Go anywhere</strong>
            <span>Real places, today's weather, real sources.</span>
          </li>
          <li>
            <span aria-hidden="true">💬</span>
            <strong>Talk with locals</strong>
            <span>Earn trust to unlock their stories.</span>
          </li>
          <li>
            <span aria-hidden="true">🧑‍🏫</span>
            <strong>Learn from a mentor</strong>
            <span>Specific feedback on your own words.</span>
          </li>
        </ol>
        <ModeBadges />
      </div>
    </div>
  );
}

export function OnboardingScreen() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [ageBand, setAgeBand] = useState<"teen" | "adult">("adult");
  const [focus, setFocus] = useState<SkillId>("curiosity");

  const next = (event: FormEvent) => {
    event.preventDefault();
    if (step < 2) setStep(step + 1);
    else completeOnboarding({ name: name.trim() || "Traveler", ageBand, focusSkill: focus, createdAt: Date.now() });
  };

  return (
    <div className="onboarding">
      <form className="onboarding-card" onSubmit={next} aria-labelledby="onb-title">
        <p className="step-dots" aria-label={`Step ${step + 1} of 3`}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={i <= step ? "on" : ""} />
          ))}
        </p>
        {step === 0 ? (
          <>
            <h2 id="onb-title">What should the locals call you?</h2>
            <label className="field">
              <span>Your name</span>
              <input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" />
            </label>
            <fieldset className="field">
              <legend>Your age</legend>
              <div className="segmented">
                <label className={ageBand === "teen" ? "is-on" : ""}>
                  <input type="radio" name="age" checked={ageBand === "teen"} onChange={() => setAgeBand("teen")} /> 13–17
                </label>
                <label className={ageBand === "adult" ? "is-on" : ""}>
                  <input type="radio" name="age" checked={ageBand === "adult"} onChange={() => setAgeBand("adult")} /> 18+
                </label>
              </div>
            </fieldset>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <h2 id="onb-title">What would you like to get better at?</h2>
            <p className="muted">Pick a focus. Your expeditions and coaching will lean toward it — you can change it any time.</p>
            <div className="skill-picker" role="radiogroup" aria-label="Focus skill">
              {SKILL_IDS.map((id) => (
                <button key={id} type="button" role="radio" aria-checked={focus === id} className={`skill-option${focus === id ? " is-on" : ""}`} onClick={() => setFocus(id)}>
                  <span className="skill-option__icon" aria-hidden="true">
                    {SKILLS[id].icon}
                  </span>
                  <strong>{SKILLS[id].name}</strong>
                  <span>{SKILLS[id].tagline}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
        {step === 2 ? (
          <>
            <h2 id="onb-title">How it works</h2>
            <ul className="rules">
              <li>
                <strong>Rapport is earned.</strong> Locals have their own lives and moods. Genuine questions, listening and respect build trust; assumptions and pushiness
                cost it.
              </li>
              <li>
                <strong>Trust unlocks insights</strong> about nature, culture, history, society and the economy — each with its source.
              </li>
              <li>
                <strong>Your coach</strong> can give you three hints per conversation. Use them when you're stuck.
              </li>
              <li>
                <strong>Reflect first, then get feedback.</strong> Rate yourself, then your mentor shows what worked — quoting your own words.
              </li>
            </ul>
            <p className="notice">
              Characters are fictional and played by AI. Facts come with sources you can check. This is practice for real conversations — it works best when you try
              what you learn with real people.
            </p>
          </>
        ) : null}
        <div className="onboarding-actions">
          {step > 0 ? (
            <button type="button" className="btn btn--ghost" onClick={() => setStep(step - 1)}>
              Back
            </button>
          ) : (
            <span />
          )}
          <button type="submit" className="btn btn--primary">
            {step < 2 ? "Next" : "Open the map"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function AccessGate() {
  const [code, setCode] = useState("");
  return (
    <div className="onboarding">
      <form
        className="onboarding-card"
        onSubmit={(e) => {
          e.preventDefault();
          submitAccessCode(code);
        }}
      >
        <Logo size={48} />
        <h2>Enter the access code</h2>
        <p className="muted">This copy of Common Ground is private. Your teacher or host can give you the code.</p>
        <label className="field">
          <span>Access code</span>
          <input autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <button type="submit" className="btn btn--primary" disabled={!code.trim()}>
          Continue
        </button>
      </form>
    </div>
  );
}
