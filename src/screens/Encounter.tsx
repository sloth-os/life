import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { HINTS_PER_ENCOUNTER, PLAYER_MESSAGE_MAX, TURN_SOFT_CAP } from "../../shared/rules.ts";
import type { AppConfig, Expedition, NpcCard } from "../../shared/schemas.ts";
import { SKILLS } from "../../shared/skills.ts";
import { LENSES, SCENARIOS, type EmotionId } from "../../shared/world.ts";
import { DeliveryChip, MicButton, ReflectionForm, VoiceStatus, isSendKey, useVoiceInput } from "../components/conversation.tsx";
import { Avatar, EmotionChip, LensTag, MoveChips, RapportMeter, Spinner } from "../components/ui.tsx";
import { canListen, listen } from "../lib/speech.ts";
import { createSceneView } from "../map/index.ts";
import type { SceneView } from "../map/types.ts";
import { abandonEncounter, leaveEncounter, requestHint, sendMessage, submitReflection } from "../state/actions.ts";
import { useGame } from "../state/store.ts";
import type { EncounterState } from "../state/types.ts";
import { lensName, scenarioName, skillName, t } from "../i18n/index.ts";

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
          {mode === "loading" ? <Spinner label={t("encounter.findingStreetView")} /> : null}
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
            {t("encounter.photoCredit")}
          </a>
        ) : null}
      </div>
    </div>
  );
}

const END_TEXT: Record<string, (name: string) => string> = {
  farewell: () => t("encounter.endFarewell"),
  walked_away: (name) => t("encounter.endWalkedAway", { name }),
  turn_limit: (name) => t("encounter.endTurnLimit", { name }),
  left: () => t("encounter.endLeft"),
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
    <ol className="transcript" ref={ref} aria-live="polite" aria-label={t("encounter.conversation")}>
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
                      {LENSES[insight.lens].icon} {t("encounter.insightUnlocked", { lens: lensName(insight.lens) })}
                    </span>
                    <strong>{insight.title}</strong>
                    <span className="muted small">{t("encounter.savedToJournal")}</span>
                  </div>
                ) : null;
              })}
            </div>
          </li>
        ) : (
          <li key={i} className="msg msg--player">
            <div className="msg__body">
              <p className="bubble">{entry.text}</p>
              {entry.delivery ? <DeliveryChip delivery={entry.delivery} /> : null}
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
              <p className="bubble typing" aria-label={t("encounter.isThinking", { name: firstName ?? "" })}>
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
          <button type="button" className="icon-btn" aria-label={t("coach.hide")} onClick={onDismiss}>
            ×
          </button>
          <p className="eyebrow">
            {SKILLS[latest.skill].icon} {t("coach.label", { skill: skillName(latest.skill) })}
          </p>
          <p>{latest.observation}</p>
          <p>
            <strong>{latest.suggestion}</strong>
          </p>
          {latest.example ? (
            <button type="button" className="coach__example" onClick={() => onUse(latest.example)} title={t("coach.useExample")}>
              {t("coach.try", { example: latest.example })}
            </button>
          ) : null}
        </div>
      ) : null}
      <button type="button" className="btn btn--small" onClick={() => void requestHint()} disabled={left <= 0 || loading || encounter.awaiting} data-testid="coach-btn">
        {loading ? <Spinner /> : "💡"} {left > 0 ? t("coach.button", { left }) : t("coach.none")}
      </button>
    </div>
  );
}

function Composer({ encounter }: { encounter: EncounterState }) {
  const { settings } = useGame();
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState<null | (() => void)>(null);
  // Voice mode through the server's voice model: record, then the model hears what was said and how.
  const voice = useVoiceInput(`The learner is talking with ${encounter.persona.name} (${encounter.persona.role}) at ${encounter.persona.placeName}.`, (transcript) => {
    setDraft(transcript);
    inputRef.current?.focus();
  });
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
    const { delivery, spoken } = voice;
    setDraft("");
    voice.setDelivery(null);
    setDismissedHints(encounter.hints.length);
    const ok = await sendMessage(text, spoken);
    if (!ok) {
      setDraft(text);
      voice.setDelivery(delivery);
    }
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isSendKey(event)) {
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
          onChange={(e) => {
            setDraft(e.target.value);
            if (!e.target.value.trim()) voice.setDelivery(null);
          }}
          onKeyDown={onKeyDown}
          placeholder={t("composer.placeholder", { name: firstName ?? "" })}
          aria-label={t("composer.label", { name: firstName ?? "" })}
          enterKeyHint="send"
          disabled={encounter.awaiting}
          autoFocus
        />
        {settings.voiceInput && voice.available ? (
          <MicButton input={voice} disabled={encounter.awaiting} />
        ) : settings.voiceInput && canListen() ? (
          <button type="button" className={`icon-btn mic${listening ? " is-on" : ""}`} onClick={toggleMic} aria-pressed={Boolean(listening)} aria-label={listening ? t("composer.stopDictation") : t("composer.speak")}>
            🎙️
          </button>
        ) : null}
        <button type="submit" className="btn btn--primary" disabled={!draft.trim() || encounter.awaiting} data-testid="send-btn">
          {t("composer.send")}
        </button>
      </div>
      <VoiceStatus input={voice} />
      <div className="composer__meta">
        <span className="muted small">
          {turns < TURN_SOFT_CAP ? t("composer.turns", { turns, cap: TURN_SOFT_CAP }) : t("composer.wrapUp")} · {t("composer.enterToSend")}
        </span>
        <button type="button" className="link-btn small" onClick={() => leaveEncounter()} disabled={encounter.awaiting}>
          {t("composer.end")}
        </button>
      </div>
    </form>
  );
}

function Reflection({ encounter }: { encounter: EncounterState }) {
  const name = encounter.persona.name.split(" ")[0]!;
  return <ReflectionForm reason={(END_TEXT[encounter.endReason ?? "left"] ?? END_TEXT.left!)(name)} onSubmit={(rating, note) => void submitReflection(rating, note)} />;
}

export function EncounterScreen() {
  const game = useGame();
  const encounter = game.active.encounter;
  const expedition = encounter ? game.expeditions.find((e) => e.id === encounter.expeditionId) : undefined;
  const npc = expedition?.npcs.find((n) => n.id === encounter?.npcId);

  if (!encounter || !expedition || !npc) {
    return (
      <div className="page">
        <p>{t("encounter.none")}</p>
        <button type="button" className="btn btn--primary" onClick={() => abandonEncounter()}>
          {t("common.back")}
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
      <section className="chat" aria-label={t("encounter.conversationWith", { name: persona.name })}>
        <header className="chat__head">
          <button
            type="button"
            className="link-btn back"
            onClick={() => {
              if (!hasSpoken || encounter.status !== "active" || window.confirm(t("encounter.leaveConfirm"))) abandonEncounter();
            }}
          >
            ← {t("encounter.backToLocals")}
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
              {scenario.icon} {scenarioName(npc.scenario)}
            </span>
            <LensTag lens={npc.lens} />
            <span className="muted small">
              📗 {t("encounter.insights", { found, total: persona.insights.length })}
            </span>
            <p>
              <strong>{t("encounter.yourGoal")}</strong> {npc.goal}
            </p>
          </div>
        </header>
        <Transcript encounter={encounter} npc={npc} />
        {encounter.status === "active" ? <Composer encounter={encounter} /> : <Reflection encounter={encounter} />}
      </section>
    </div>
  );
}
