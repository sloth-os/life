import { useState, type FormEvent } from "react";
import { SKILL_IDS, SKILLS, type SkillId } from "../../shared/skills.ts";
import { Logo } from "../components/ui.tsx";
import { completeOnboarding, go, submitAccessCode, updateSettings } from "../state/actions.ts";
import { useGame } from "../state/store.ts";
import { LANGS, LANG_NAMES, lang, skillText, t, type Lang } from "../i18n/index.ts";

export function ModeBadges() {
  const { config } = useGame().ui;
  if (!config) return null;
  return (
    <p className="mode-badges">
      <span className={`mode mode--${config.aiMode}`}>{config.aiMode === "claude" ? t("mode.aiClaude") : config.aiMode === "openai" ? t("mode.aiModel", { model: config.model ?? "" }) : t("mode.aiDemo")}</span>
      <span className={`mode mode--${config.mapsMode}`}>{config.mapsMode === "google" ? t("mode.mapGoogle") : t("mode.mapOpen")}</span>
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
        <p className="tagline">{t("title.tagline")}</p>
        <p className="lede">{t("title.lede")}</p>
        <div className="cta-row">
          {game.player ? (
            <button type="button" className="btn btn--primary btn--lg" onClick={() => go("world")}>
              {t("title.continue", { name: game.player.name })}
            </button>
          ) : (
            <button type="button" className="btn btn--primary btn--lg" onClick={() => go("onboarding")}>
              {t("title.begin")}
            </button>
          )}
        </div>
        <ol className="how">
          <li>
            <span aria-hidden="true">🌍</span>
            <strong>{t("title.howGo")}</strong>
            <span>{t("title.howGoText")}</span>
          </li>
          <li>
            <span aria-hidden="true">💬</span>
            <strong>{t("title.howTalk")}</strong>
            <span>{t("title.howTalkText")}</span>
          </li>
          <li>
            <span aria-hidden="true">🧑‍🏫</span>
            <strong>{t("title.howLearn")}</strong>
            <span>{t("title.howLearnText")}</span>
          </li>
        </ol>
        <ModeBadges />
        <LanguagePicker />
      </div>
    </div>
  );
}

/** The interface language (the AI writes in it too). */
export function LanguagePicker() {
  const settings = useGame().settings;
  return (
    <label className="language-picker">
      <span aria-hidden="true">🌐</span>
      <span className="sr-only">{t("settings.language")}</span>
      <select value={settings.language ?? lang()} onChange={(e) => updateSettings({ language: e.target.value as Lang })} data-testid="language-select">
        {LANGS.map((l) => (
          <option key={l} value={l}>
            {LANG_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
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
    else completeOnboarding({ name: name.trim() || t("onboarding.defaultName"), ageBand, focusSkill: focus, createdAt: Date.now() });
  };

  return (
    <div className="onboarding">
      <form className="onboarding-card" onSubmit={next} aria-labelledby="onb-title">
        <p className="step-dots" aria-label={t("onboarding.step", { step: step + 1, total: 3 })}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={i <= step ? "on" : ""} />
          ))}
        </p>
        {step === 0 ? (
          <>
            <h2 id="onb-title">{t("onboarding.nameTitle")}</h2>
            <label className="field">
              <span>{t("onboarding.name")}</span>
              <input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={t("onboarding.namePlaceholder")} />
            </label>
            <fieldset className="field">
              <legend>{t("onboarding.age")}</legend>
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
            <h2 id="onb-title">{t("onboarding.focusTitle")}</h2>
            <p className="muted">{t("onboarding.focusText")}</p>
            <div className="skill-picker" role="radiogroup" aria-label={t("onboarding.focusSkill")}>
              {SKILL_IDS.map((id) => (
                <button key={id} type="button" role="radio" aria-checked={focus === id} className={`skill-option${focus === id ? " is-on" : ""}`} onClick={() => setFocus(id)}>
                  <span className="skill-option__icon" aria-hidden="true">
                    {SKILLS[id].icon}
                  </span>
                  <strong>{skillText(id).name}</strong>
                  <span>{skillText(id).tagline}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
        {step === 2 ? (
          <>
            <h2 id="onb-title">{t("onboarding.howTitle")}</h2>
            <ul className="rules">
              <li>
                <strong>{t("onboarding.rule1")}</strong> {t("onboarding.rule1Text")}
              </li>
              <li>
                <strong>{t("onboarding.rule2")}</strong> {t("onboarding.rule2Text")}
              </li>
              <li>
                <strong>{t("onboarding.rule3")}</strong> {t("onboarding.rule3Text")}
              </li>
              <li>
                <strong>{t("onboarding.rule4")}</strong> {t("onboarding.rule4Text")}
              </li>
            </ul>
            <p className="notice">{t("onboarding.notice")}</p>
          </>
        ) : null}
        <div className="onboarding-actions">
          {step > 0 ? (
            <button type="button" className="btn btn--ghost" onClick={() => setStep(step - 1)}>
              {t("common.back")}
            </button>
          ) : (
            <span />
          )}
          <button type="submit" className="btn btn--primary">
            {step < 2 ? t("common.next") : t("onboarding.openMap")}
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
        <h2>{t("access.title")}</h2>
        <p className="muted">{t("access.text")}</p>
        <label className="field">
          <span>{t("access.code")}</span>
          <input autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <button type="submit" className="btn btn--primary" disabled={!code.trim()}>
          {t("common.continue")}
        </button>
      </form>
    </div>
  );
}
