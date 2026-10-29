import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { HINTS_PER_ENCOUNTER, PLAYER_MESSAGE_MAX, TURN_SOFT_CAP } from "../../shared/rules.ts";
import type { AppConfig, Expedition, NpcCard } from "../../shared/schemas.ts";
import { SKILLS } from "../../shared/skills.ts";
import { LENSES, SCENARIOS, type EmotionId } from "../../shared/world.ts";
import { Avatar, EmotionChip, LensTag, MoveChips, RapportMeter, Spinner } from "../components/ui.tsx";
import { canListen, listen } from "../lib/speech.ts";
import { createSceneView } from "../map/index.ts";
import type { SceneView } from "../map/types.ts";
import { abandonEncounter, leaveEncounter, requestHint, sendMessage, submitReflection } from "../state/actions.ts";
import { useGame } from "../state/store.ts";
import type { EncounterState } from "../state/types.ts";

/** Street View in Google mode; otherwise a photo of the place from Wikipedia, or an illustrated card. */
function Scene({ config, expedition, npc }: { config: AppConfig; expedition: Expedition; npc: NpcCard }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"loading" | "streetview" | "card">(config.mapsMode === "google" ? "loading" : "card");
  const [photo, setPhoto] = useState<{ src: string; page: string } | null>(null);

  useEffect(() => {
    if (config.mapsMode !== "google" || !npc.location) {
      setMode("card");
      return;
    }
    let view: SceneView | null = null;
    let cancelled = false;
    createSceneView(ref.current!, config)
      .then(async (created) => {
        view = created;
        if (!created || cancelled) return setMode("card");
        const ok = await created.show(npc.location!, npc.location);
        if (!cancelled) setMode(ok ? "streetview" : "card");
      })
      .catch(() => !cancelled && setMode("card"));
    return () => {
      cancelled = true;
      view?.destroy();
    };
  }, [config, npc.location]);

  // Open mode: a photo of the local's place from its Wikipedia article (Wikimedia Commons).
  useEffect(() => {
    if (config.mapsMode === "google") return;
    const source = expedition.sources.find((s) => s.id === npc.placeSourceId && s.kind === "wikipedia" && s.url);
    const match = source?.url ? /^https:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/(.+)$/.exec(source.url) : null;
    if (!match) return;
    let cancelled = false;
    fetch(`https://${match[1]}.wikipedia.org/api/rest_v1/page/summary/${match[2]}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { originalimage?: { source: string }; thumbnail?: { source: string } } | null) => {
        const src = data?.thumbnail?.source ?? data?.originalimage?.source;
        if (!cancelled && src) setPhoto({ src: src.replace(/\/\d+px-/, "/960px-").replace(/"/g, "%22"), page: source!.url! });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [config.mapsMode, expedition.sources, npc.placeSourceId]);

  const lens = LENSES[npc.lens];
  return (
    <div className="scene-frame" style={{ "--lens-color": lens.color } as CSSProperties}>
      <div ref={ref} className={`scene-frame__pano${mode === "streetview" ? "" : " is-hidden"}`} />
      {mode !== "streetview" ? (
        <div className="scene-card" style={photo ? ({ backgroundImage: `url("${photo.src}")` } as CSSProperties) : undefined}>
          {mode === "loading" ? <Spinner label="Finding a street view…" /> : null}
          {!photo && mode === "card" ? (
            <span className="scene-card__icon" aria-hidden="true">
              {lens.icon}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="scene-caption">
        <strong>{npc.placeName}</strong>
        <span>
          {[expedition.locality.city, expedition.locality.country].filter(Boolean).join(", ")}
          {expedition.weather ? ` · ${expedition.weather.summary}` : ""}
        </span>
        {photo ? (
          <a href={photo.page} target="_blank" rel="noreferrer" className="scene-caption__credit">
            Photo via Wikipedia
          </a>
        ) : null}
      </div>
    </div>
  );
}

const END_TEXT: Record<string, (name: string) => string> = {
  farewell: () => "You said goodbye.",
  walked_away: (name) => `${name} walked away.`,
  turn_limit: (name) => `${name} had to get back to their day.`,
  left: () => "You ended the conversation.",
};

/** "wipes her hands" → "Amina wipes her hands" (unless the model already named them). */
function gestureLine(firstName: string, gesture: string): string {
  const g = gesture.trim().replace(/^\*|\*$/g, "");
  if (!firstName || g.toLowerCase().startsWith(firstName.toLowerCase())) return g;
  return `${firstName} ${g.replace(/^(he|she|they)\s+/i, "")}`;
}

function Transcript({ encounter, npc }: { encounter: EncounterState; npc: NpcCard }) {
  const ref = useRef<HTMLOListElement>(null);
  const length = encounter.transcript.length;
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [length, encounter.streaming, encounter.hints.length]);
  const firstName = encounter.persona.name.split(" ")[0];

  return (
    <ol className="transcript" ref={ref} aria-live="polite" aria-label="Conversation">
      {encounter.transcript.map((entry, i) =>
        entry.speaker === "npc" ? (
          <li key={i} className="msg msg--npc">
            <Avatar name={encounter.persona.name} hue={npc.hue} size={30} />
            <div className="msg__body">
              {entry.gesture ? <p className="gesture">{gestureLine(firstName ?? "", entry.gesture)}</p> : null}
              <p className="bubble">{entry.text}</p>
              {entry.phrase ? (
                <p className="phrase">
                  🗣 <strong>{entry.phrase.text}</strong> — {entry.phrase.meaning}
                </p>
              ) : null}
              {entry.revealedInsightIds.map((id) => {
                const insight = encounter.persona.insights.find((x) => x.id === id);
                return insight ? (
                  <div key={id} className="insight-pop" style={{ "--lens-color": LENSES[insight.lens].color } as CSSProperties}>
                    <span className="eyebrow">
                      {LENSES[insight.lens].icon} Insight unlocked · {LENSES[insight.lens].name}
                    </span>
                    <strong>{insight.title}</strong>
                    <span className="muted small">Saved to your field journal</span>
                  </div>
                ) : null;
              })}
            </div>
          </li>
        ) : (
          <li key={i} className="msg msg--player">
            <div className="msg__body">
              <p className="bubble">{entry.text}</p>
              <MoveChips moves={entry.moves ?? []} />
            </div>
          </li>
        ),
      )}
      {encounter.awaiting ? (
        <li className="msg msg--npc is-streaming">
          <Avatar name={encounter.persona.name} hue={npc.hue} size={30} />
          <div className="msg__body">
            {encounter.streaming ? (
              <p className="bubble">
                {encounter.streaming}
                <span className="caret" aria-hidden="true" />
              </p>
            ) : (
              <p className="bubble typing" aria-label={`${firstName} is thinking`}>
                <span />
                <span />
                <span />
              </p>
            )}
          </div>
        </li>
      ) : null}
    </ol>
  );
}

function Coach({ encounter, onUse, dismissed, onDismiss }: { encounter: EncounterState; onUse: (text: string) => void; dismissed: number; onDismiss: () => void }) {
  const loading = useGame().ui.hintLoading;
  const left = HINTS_PER_ENCOUNTER - encounter.hints.length;
  const latest = encounter.hints.length > dismissed ? encounter.hints.at(-1) : undefined;
  return (
    <div className="coach">
      {latest ? (
        <div className="coach__hint" role="note">
          <button type="button" className="icon-btn" aria-label="Hide tip" onClick={onDismiss}>
            ×
          </button>
          <p className="eyebrow">
            {SKILLS[latest.skill].icon} Coach · {SKILLS[latest.skill].name}
          </p>
          <p>{latest.observation}</p>
          <p>
            <strong>{latest.suggestion}</strong>
          </p>
          {latest.example ? (
            <button type="button" className="coach__example" onClick={() => onUse(latest.example)} title="Put this in your message box">
              Try: “{latest.example}”
            </button>
          ) : null}
        </div>
      ) : null}
      <button type="button" className="btn btn--small" onClick={() => void requestHint()} disabled={left <= 0 || loading || encounter.awaiting} data-testid="coach-btn">
        {loading ? <Spinner /> : "💡"} Coach{left > 0 ? ` (${left} left)` : " — no hints left"}
      </button>
    </div>
  );
}

function Composer({ encounter }: { encounter: EncounterState }) {
  const settings = useGame().settings;
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState<null | (() => void)>(null);
  // Hints already read: a tip folds away once you act on it (or close it).
  const [dismissedHints, setDismissedHints] = useState(encounter.hints.length);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const turns = encounter.transcript.filter((e) => e.speaker === "player").length;
  const firstName = encounter.persona.name.split(" ")[0];

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || encounter.awaiting) return;
    listening?.();
    setDraft("");
    setDismissedHints(encounter.hints.length);
    const ok = await sendMessage(text);
    if (!ok) setDraft(text);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const toggleMic = () => {
    if (listening) {
      listening();
      setListening(null);
      return;
    }
    const stop = listen(
      (text) => setDraft(text),
      () => setListening(null),
    );
    setListening(() => stop);
  };

  return (
    <form className="composer" onSubmit={(e) => void submit(e)}>
      <Coach
        encounter={encounter}
        dismissed={dismissedHints}
        onDismiss={() => setDismissedHints(encounter.hints.length)}
        onUse={(text) => {
          setDraft(text);
          inputRef.current?.focus();
        }}
      />
      <div className="composer__box">
        <textarea
          ref={inputRef}
          value={draft}
          maxLength={PLAYER_MESSAGE_MAX}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Say something to ${firstName}…`}
          aria-label={`Your message to ${firstName}`}
          disabled={encounter.awaiting}
          autoFocus
        />
        {settings.voiceInput && canListen() ? (
          <button type="button" className={`icon-btn mic${listening ? " is-on" : ""}`} onClick={toggleMic} aria-pressed={Boolean(listening)} aria-label={listening ? "Stop dictation" : "Speak your message"}>
            🎙️
          </button>
        ) : null}
        <button type="submit" className="btn btn--primary" disabled={!draft.trim() || encounter.awaiting} data-testid="send-btn">
          Send
        </button>
      </div>
      <div className="composer__meta">
        <span className="muted small">
          {turns < TURN_SOFT_CAP ? `${turns} of ~${TURN_SOFT_CAP} turns` : "Time to wrap up"} · Enter to send
        </span>
        <button type="button" className="link-btn small" onClick={() => leaveEncounter()} disabled={encounter.awaiting}>
          End conversation
        </button>
      </div>
    </form>
  );
}

const RATING_LABELS = ["Rough", "Shaky", "Okay", "Good", "Great"];

function Reflection({ encounter }: { encounter: EncounterState }) {
  const loading = useGame().ui.debriefLoading;
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState("");
  const name = encounter.persona.name.split(" ")[0]!;
  return (
    <div className="ended">
      <p className="ended__reason" role="status">
        {(END_TEXT[encounter.endReason ?? "left"] ?? END_TEXT.left!)(name)}
      </p>
      <form
        className="reflect"
        onSubmit={(e) => {
          e.preventDefault();
          if (rating) void submitReflection(rating, note);
        }}
      >
        <h3>Before your mentor weighs in…</h3>
        <p>How do you think that conversation went?</p>
        <div className="stars" role="radiogroup" aria-label="Your self-rating">
          {RATING_LABELS.map((label, i) => (
            <button key={label} type="button" role="radio" aria-checked={rating === i + 1} className={rating >= i + 1 ? "is-on" : ""} onClick={() => setRating(i + 1)} data-testid={`rate-${i + 1}`}>
              <span aria-hidden="true">★</span>
              <span className="stars__label">{label}</span>
            </button>
          ))}
        </div>
        <label className="field">
          <span>What would you do differently? (optional)</span>
          <textarea value={note} maxLength={400} rows={2} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className="btn btn--primary" disabled={!rating || loading} data-testid="get-feedback">
          {loading ? <Spinner label="Your mentor is reviewing the conversation…" /> : "Get feedback"}
        </button>
      </form>
    </div>
  );
}

export function EncounterScreen() {
  const game = useGame();
  const encounter = game.active.encounter;
  const expedition = encounter ? game.expeditions.find((e) => e.id === encounter.expeditionId) : undefined;
  const npc = expedition?.npcs.find((n) => n.id === encounter?.npcId);

  if (!encounter || !expedition || !npc) {
    return (
      <div className="page">
        <p>No conversation in progress.</p>
        <button type="button" className="btn btn--primary" onClick={() => abandonEncounter()}>
          Back
        </button>
      </div>
    );
  }

  const persona = encounter.persona;
  const lastNpc = [...encounter.transcript].reverse().find((e) => e.speaker === "npc");
  const emotion: EmotionId = lastNpc?.speaker === "npc" ? lastNpc.emotion : "neutral";
  const lastDelta = lastNpc?.speaker === "npc" && encounter.transcript.length > 1 ? lastNpc.rapportDelta : undefined;
  const scenario = SCENARIOS[npc.scenario];
  const found = encounter.unlockedInsightIds.length;
  const hasSpoken = encounter.transcript.some((e) => e.speaker === "player");

  return (
    <div className="encounter">
      <Scene config={game.ui.config!} expedition={expedition} npc={npc} />
      <section className="chat" aria-label={`Conversation with ${persona.name}`}>
        <header className="chat__head">
          <button
            type="button"
            className="link-btn back"
            onClick={() => {
              if (!hasSpoken || encounter.status !== "active" || window.confirm("Leave without feedback? This conversation won't count.")) abandonEncounter();
            }}
          >
            ← Locals
          </button>
          <div className="chat__who">
            <Avatar name={persona.name} hue={npc.hue} size={48} />
            <div>
              <h2>
                {persona.name} <span className="muted">· {persona.age}</span>
              </h2>
              <p className="muted small">
                {persona.role} · {persona.placeName}
              </p>
            </div>
            <EmotionChip emotion={emotion} />
          </div>
          <RapportMeter value={encounter.rapport} delta={lastDelta} thresholds={persona.insights.map((i) => i.threshold)} />
          <div className="chat__goal">
            <span className="tag">
              {scenario.icon} {scenario.name}
            </span>
            <LensTag lens={npc.lens} />
            <span className="muted small">
              📗 {found}/{persona.insights.length} insights
            </span>
            <p>
              <strong>Your goal:</strong> {npc.goal}
            </p>
          </div>
        </header>
        <Transcript encounter={encounter} npc={npc} />
        {encounter.status === "active" ? <Composer encounter={encounter} /> : <Reflection encounter={encounter} />}
      </section>
    </div>
  );
}
