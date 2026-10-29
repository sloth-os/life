import { rankFor } from "../../shared/rules.ts";
import { SKILL_IDS, SKILLS, skillLevelName } from "../../shared/skills.ts";
import { SkillRadar } from "../components/ui.tsx";
import { canListen, canSpeak } from "../lib/speech.ts";
import { setFocusSkill, updateSettings } from "../state/actions.ts";
import { store, useGame } from "../state/store.ts";

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
        <h1>Skill Compass</h1>
        <p className="muted">
          {rankFor(xp).name} · {xp} XP · {encounters} conversation{encounters === 1 ? "" : "s"}
        </p>
      </header>

      <div className="compass-top">
        <div className="card radar-card">
          <SkillRadar values={ratings} />
        </div>
        <div className="card">
          <h2>Your focus</h2>
          <p className="muted small">Expeditions and coaching lean toward your focus skill.</p>
          <div className="focus-list" role="radiogroup" aria-label="Focus skill">
            {SKILL_IDS.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={game.player?.focusSkill === id} className={game.player?.focusSkill === id ? "is-on" : ""} onClick={() => setFocusSkill(id)}>
                {SKILLS[id].icon} {SKILLS[id].name}
              </button>
            ))}
          </div>
          <h2>Self-awareness</h2>
          {avgGap === null ? (
            <p className="muted small">After a few conversations you'll see how your self-ratings compare with your mentor's.</p>
          ) : (
            <>
              <p>
                {Math.abs(avgGap) < 0.5
                  ? "Your self-ratings closely match your mentor's — great calibration."
                  : avgGap > 0
                    ? "You tend to rate yourself a little higher than your mentor does. Look closely at the moments where rapport dipped."
                    : "You tend to be harder on yourself than your mentor is. Notice what's already working!"}
              </p>
              <div className="calibration" aria-label="Recent self-rating gaps">
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
                  <h3>{skill.name}</h3>
                  <p className="muted small">
                    {skillLevelName(progress.rating)} · {progress.rating}/100 · {progress.evidence} conversation{progress.evidence === 1 ? "" : "s"} of evidence
                  </p>
                </div>
                <Sparkline values={progress.history} />
              </div>
              <div className="bar" aria-hidden="true">
                <span style={{ width: `${progress.rating}%` }} />
              </div>
              <p>
                <strong>{skill.tagline}</strong>
              </p>
              <ul className="bullets small">
                {skill.behaviors.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <p className="small">
                <span className="muted">Watch out for:</span> {skill.pitfalls.join(" · ")}
              </p>
              <p className="example">{skill.example}</p>
              <p className="muted small">Rooted in {skill.roots}</p>
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
        <h1>Settings</h1>
      </header>

      <section className="card">
        <h2>Voice</h2>
        <label className="toggle">
          <input type="checkbox" checked={settings.voiceInput} disabled={!canListen()} onChange={(e) => updateSettings({ voiceInput: e.target.checked })} />
          <span>Speak your messages (dictation){canListen() ? "" : " — not supported in this browser"}</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={settings.voiceOutput} disabled={!canSpeak()} onChange={(e) => updateSettings({ voiceOutput: e.target.checked })} />
          <span>Read locals' replies aloud{canSpeak() ? "" : " — not supported in this browser"}</span>
        </label>
        <p className="muted small">
          Speaking out loud is closer to real conversation. The full written transcript always stays on screen.
          {config.mapsMode === "google" ? " AI replies may include Google Maps content; sources are listed on each expedition." : ""}
        </p>
      </section>

      <section className="card">
        <h2>Display</h2>
        <fieldset className="field">
          <legend>Theme</legend>
          <div className="segmented">
            {(["system", "light", "dark"] as const).map((t) => (
              <label key={t} className={settings.theme === t ? "is-on" : ""}>
                <input type="radio" name="theme" checked={settings.theme === t} onChange={() => updateSettings({ theme: t })} /> {t[0]!.toUpperCase() + t.slice(1)}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="field">
          <legend>Text size</legend>
          <div className="segmented">
            {([1, 1.15, 1.3] as const).map((size) => (
              <label key={size} className={settings.textScale === size ? "is-on" : ""}>
                <input type="radio" name="text" checked={settings.textScale === size} onChange={() => updateSettings({ textScale: size })} /> {size === 1 ? "Normal" : size === 1.15 ? "Large" : "Larger"}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="toggle">
          <input type="checkbox" checked={settings.reducedMotion} onChange={(e) => updateSettings({ reducedMotion: e.target.checked })} />
          <span>Reduce motion</span>
        </label>
      </section>

      <section className="card">
        <h2>About this game</h2>
        <dl className="facts">
          <dt>AI</dt>
          <dd>{config.aiMode === "claude" ? `Claude (${config.model})` : "Demo AI — scripted locals built from real sources. Add an Anthropic API key on the server for Claude."}</dd>
          <dt>Map</dt>
          <dd>{config.mapsMode === "google" ? "Google Maps (Maps JavaScript API, Street View)" : "Open map mode (MapLibre · OpenFreeMap · © OpenStreetMap contributors)"}</dd>
          <dt>Place grounding</dt>
          <dd>{config.placeGrounding === "google" ? "Google Maps (Maps Experience agent tools) + Wikipedia" : "Wikipedia (CC BY-SA 4.0)"}</dd>
          <dt>Weather</dt>
          <dd>{config.mapsMode === "google" ? "Google Maps" : "Open-Meteo.com (CC BY 4.0)"}</dd>
        </dl>
        <p className="small">
          Locals are fictional characters played by AI. They're designed to feel like individuals, not stereotypes — if one ever doesn't, that's a bug worth reporting.
          Facts are grounded in the listed sources, but AI can still make mistakes: check them. Common Ground is practice for real conversations, not a replacement for
          them.
        </p>
      </section>

      <section className="card">
        <h2>Your data</h2>
        <p className="small">Progress is saved only in this browser. The server doesn't keep your conversations.</p>
        <div className="row">
          <button type="button" className="btn" onClick={download}>
            Export save
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => {
              if (window.confirm("Erase all progress, journal entries and people you've met? This can't be undone.")) store.reset();
            }}
          >
            Reset progress
          </button>
        </div>
      </section>
    </div>
  );
}
