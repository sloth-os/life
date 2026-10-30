import { rankFor } from "../../shared/rules.ts";
import { SKILL_IDS, SKILLS, skillLevelName } from "../../shared/skills.ts";
import { SkillRadar } from "../components/ui.tsx";
import { canRecord } from "../lib/recorder.ts";
import { canListen, canSpeak } from "../lib/speech.ts";
import { go, setFocusSkill, updateSettings } from "../state/actions.ts";
import { store, useGame } from "../state/store.ts";
import { LANGS, LANG_NAMES, lang, levelName, plural, rankName, skillText, t, type Lang } from "../i18n/index.ts";

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 28;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / 100) * h}`).join(" ");
  return (
    <svg className="sparkline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}

export function CompassScreen() {
  const game = useGame();
  const { skills, calibration, encounters, xp } = game.progress;
  const ratings = Object.fromEntries(SKILL_IDS.map((id) => [id, skills[id].rating])) as Record<(typeof SKILL_IDS)[number], number>;
  const recent = calibration.slice(-8);
  const avgGap = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;

  return (
    <div className="page compass">
      <header className="page-head">
        <h1>{t("compass.title")}</h1>
        <p className="muted">
          {rankName(rankFor(xp).name)} · {xp} XP · {plural(encounters, "compass.conversationOne", "compass.conversations")}
        </p>
      </header>

      <div className="compass-top">
        <div className="card radar-card">
          <SkillRadar values={ratings} />
        </div>
        <div className="card">
          <h2>{t("compass.focus")}</h2>
          <p className="muted small">{t("compass.focusText")}</p>
          <div className="focus-list" role="radiogroup" aria-label={t("onboarding.focusSkill")}>
            {SKILL_IDS.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={game.player?.focusSkill === id} className={game.player?.focusSkill === id ? "is-on" : ""} onClick={() => setFocusSkill(id)}>
                {SKILLS[id].icon} {skillText(id).name}
              </button>
            ))}
          </div>
          <h2>{t("compass.selfAwareness")}</h2>
          {avgGap === null ? (
            <p className="muted small">{t("compass.selfAwarenessEmpty")}</p>
          ) : (
            <>
              <p>
                {Math.abs(avgGap) < 0.5 ? t("compass.calibrated") : avgGap > 0 ? t("compass.overrate") : t("compass.underrate")}
              </p>
              <div className="calibration" aria-label={t("compass.gaps")}>
                {recent.map((gap, i) => (
                  <span key={i} className={gap > 0 ? "over" : "under"} style={{ height: `${Math.min(100, Math.abs(gap) * 25) + 8}%` }} title={`${gap > 0 ? "+" : ""}${gap}`} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <ul className="skill-cards">
        {SKILL_IDS.map((id) => {
          const skill = SKILLS[id];
          const progress = skills[id];
          return (
            <li key={id} className="card skill-card">
              <div className="skill-card__head">
                <span className="skill-card__icon" aria-hidden="true">
                  {skill.icon}
                </span>
                <div>
                  <h3>{skillText(id).name}</h3>
                  <p className="muted small">
                    {levelName(skillLevelName(progress.rating))} · {progress.rating}/100 · {plural(progress.evidence, "compass.evidenceOne", "compass.evidence")}
                  </p>
                </div>
                <Sparkline values={progress.history} />
              </div>
              <div className="bar" aria-hidden="true">
                <span style={{ width: `${progress.rating}%` }} />
              </div>
              <p>
                <strong>{skillText(id).tagline}</strong>
              </p>
              <ul className="bullets small">
                {skillText(id).behaviors.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <p className="small">
                <span className="muted">{t("compass.watchOut")}</span> {skillText(id).pitfalls.join(" · ")}
              </p>
              <p className="example">{skillText(id).example}</p>
              <p className="muted small">{t("compass.rootedIn", { roots: skill.roots })}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SettingsScreen() {
  const game = useGame();
  const { settings } = game;
  const config = game.ui.config!;
  const modelHears = config.features.voice && canRecord();
  const canHear = modelHears || canListen();
  const canVoice = config.features.voiceOutput === "model" || canSpeak();

  const download = () => {
    const blob = new Blob([store.exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "common-ground-save.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page settings">
      <header className="page-head">
        <h1>{t("nav.settings")}</h1>
      </header>

      <section className="card">
        <h2>{t("settings.language")}</h2>
        <label className="field">
          <span>{t("settings.languageText")}</span>
          <select value={settings.language ?? lang()} onChange={(e) => updateSettings({ language: e.target.value as Lang })} data-testid="settings-language">
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {LANG_NAMES[l]}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="card">
        <h2>{t("settings.voice")}</h2>
        <label className="toggle">
          <input type="checkbox" checked={settings.voiceInput} disabled={!canHear} onChange={(e) => updateSettings({ voiceInput: e.target.checked })} data-testid="voice-input-toggle" />
          <span>
            {t("settings.speak")}
            {modelHears ? t("settings.speakModel") : canListen() ? t("settings.speakDictation") : t("settings.unsupported")}
          </span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={settings.voiceOutput} disabled={!canVoice} onChange={(e) => updateSettings({ voiceOutput: e.target.checked })} data-testid="voice-output-toggle" />
          <span>
            {t("settings.readAloud")}
            {canVoice ? "" : t("settings.unsupported")}
          </span>
        </label>
        <p className="muted small">
          {t("settings.voiceNote")}
          {modelHears ? ` ${t("settings.recordingsNote", { model: config.model ?? "AI" })}` : ""}
          {config.mapsMode === "google" ? ` ${t("settings.mapsNote")}` : ""}
        </p>
      </section>

      <section className="card">
        <h2>{t("settings.display")}</h2>
        <fieldset className="field">
          <legend>{t("settings.theme")}</legend>
          <div className="segmented">
            {(["system", "light", "dark"] as const).map((mode) => (
              <label key={mode} className={settings.theme === mode ? "is-on" : ""}>
                <input type="radio" name="theme" checked={settings.theme === mode} onChange={() => updateSettings({ theme: mode })} /> {t(`settings.theme.${mode}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="field">
          <legend>{t("settings.textSize")}</legend>
          <div className="segmented">
            {([1, 1.15, 1.3] as const).map((size) => (
              <label key={size} className={settings.textScale === size ? "is-on" : ""}>
                <input type="radio" name="text" checked={settings.textScale === size} onChange={() => updateSettings({ textScale: size })} /> {size === 1 ? t("settings.textNormal") : size === 1.15 ? t("settings.textLarge") : t("settings.textLarger")}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="toggle">
          <input type="checkbox" checked={settings.reducedMotion} onChange={(e) => updateSettings({ reducedMotion: e.target.checked })} />
          <span>{t("settings.reduceMotion")}</span>
        </label>
        {config.features.flyIns ? (
          <label className="toggle">
            <input type="checkbox" checked={settings.flyIns !== false && !settings.reducedMotion} disabled={settings.reducedMotion} onChange={(e) => updateSettings({ flyIns: e.target.checked })} />
            <span>{t("settings.flyIns")}</span>
          </label>
        ) : null}
      </section>

      <section className="card">
        <h2>{t("settings.about")}</h2>
        <dl className="facts">
          <dt>{t("settings.ai")}</dt>
          <dd>{config.aiMode === "claude" ? `Claude (${config.model})` : config.aiMode === "openai" ? t("settings.aiOpenai", { model: config.model ?? "" }) : t("settings.aiDemo")}</dd>
          <dt>{t("settings.map")}</dt>
          <dd>{config.mapsMode === "google" ? t("settings.mapGoogle") : t("settings.mapOpen")}</dd>
          <dt>{t("settings.grounding")}</dt>
          <dd>{config.placeGrounding === "google" ? t("settings.groundingGoogle") : t("settings.groundingWiki")}</dd>
          <dt>{t("settings.weather")}</dt>
          <dd>{config.mapsMode === "google" ? "Google Maps" : "Open-Meteo.com (CC BY 4.0)"}</dd>
        </dl>
        <p className="small">
          {t("settings.aboutText")}
        </p>
      </section>

      {config.settingsPage ? (
        <section className="card">
          <h2>{t("settings.server")}</h2>
          <p className="small">{t("settings.serverText")}</p>
          <button type="button" className="btn" onClick={() => go("server")} data-testid="open-server-settings">
            ⚙️ {t("settings.openServer")}
          </button>
        </section>
      ) : null}

      <section className="card">
        <h2>{t("settings.data")}</h2>
        <p className="small">{t("settings.dataText")}</p>
        <div className="row">
          <button type="button" className="btn" onClick={download}>
            {t("settings.export")}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => {
              if (window.confirm(t("settings.resetConfirm"))) store.reset();
            }}
          >
            {t("settings.reset")}
          </button>
        </div>
      </section>
    </div>
  );
}
