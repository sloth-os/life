// Mediation scenes: two locals at odds, and the learner in the middle. Both can answer each
// turn; the tension meter and each person's trust move with how the learner handles it.
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { AGREEMENT_TENSION_MAX, MEDIATION_TURN_SOFT_CAP, PLAYER_MESSAGE_MAX } from "../../shared/rules.ts";
import type { MediationScene, Party, PartyId } from "../../shared/schemas.ts";
import { DeliveryChip, MicButton, ReflectionForm, VoiceStatus, useVoiceInput } from "../components/conversation.tsx";
import { Avatar, EmotionChip, MoveChips } from "../components/ui.tsx";
import { abandonMediation, leaveMediation, sendMediationMessage, submitMediationReflection } from "../state/actions.ts";
import { useGame } from "../state/store.ts";
import type { MediationState } from "../state/types.ts";

const partyOf = (scene: MediationScene, who: PartyId): Party => scene.parties[who === "a" ? 0 : 1];
const first = (name: string) => name.split(" ")[0]!;

/** 0 calm … 100 boiling over. */
function TensionMeter({ value }: { value: number }) {
  const v = Math.round(value);
  const label = v >= 75 ? "Heated" : v > AGREEMENT_TENSION_MAX ? "Tense" : v > 25 ? "Cooling" : "Calm";
  return (
    <div className="tension" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={`Tension ${v} of 100: ${label}`} data-testid="tension">
      <span className="tension__label">Tension</span>
      <strong>{label}</strong>
      <div className="tension__track">
        <div className="tension__fill" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function PartyCard({ party, trust }: { party: Party; trust: number }) {
  return (
    <div className="party" style={{ "--party-hue": party.hue } as CSSProperties}>
      <Avatar name={party.name} hue={party.hue} size={40} />
      <div>
        <h3>
          {party.name} <span className="muted">· {party.age}</span>
        </h3>
        <p className="muted small">{party.role}</p>
        <p className="party__position">“{party.position}”</p>
        <div className="party__trust" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(trust)} aria-label={`${first(party.name)} trusts you ${Math.round(trust)} of 100`}>
          <span className="muted small">Trusts you</span>
          <div className="rapport__track">
            <div className="rapport__fill" style={{ width: `${Math.round(trust)}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Transcript({ mediation }: { mediation: MediationState }) {
  const ref = useRef<HTMLOListElement>(null);
  const { scene } = mediation;
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [mediation.transcript.length, mediation.streaming]);
  const line = (who: PartyId, text: string, gesture: string | undefined, key: string) => {
    const party = partyOf(scene, who);
    return (
      <li key={key} className={`msg msg--npc msg--party-${who}`}>
        <Avatar name={party.name} hue={party.hue} size={30} />
        <div className="msg__body">
          <p className="msg__name">{first(party.name)}</p>
          {gesture ? <p className="gesture">{gesture}</p> : null}
          <p className="bubble">{text}</p>
        </div>
      </li>
    );
  };
  return (
    <ol className="transcript" ref={ref} aria-live="polite" aria-label="Conversation">
      {scene.opening.map((l, i) => line(l.who, l.text, l.gesture, `o${i}`))}
      {mediation.transcript.map((entry, i) =>
        entry.speaker === "party" ? (
          line(entry.who, entry.text, entry.gesture, `t${i}`)
        ) : (
          <li key={`t${i}`} className="msg msg--player">
            <div className="msg__body">
              <p className="bubble">{entry.text}</p>
              {entry.delivery ? <DeliveryChip delivery={entry.delivery} /> : null}
              <MoveChips moves={entry.moves ?? []} />
            </div>
          </li>
        ),
      )}
      {mediation.awaiting ? (
        <li className="msg msg--npc is-streaming">
          <div className="msg__body">
            {mediation.streaming ? (
              <p className="bubble">
                {mediation.streaming}
                <span className="caret" aria-hidden="true" />
              </p>
            ) : (
              <p className="bubble typing" aria-label="They're answering">
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

function Composer({ mediation }: { mediation: MediationState }) {
  const { settings } = useGame();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [a, b] = mediation.scene.parties;
  const voice = useVoiceInput(`The learner is mediating between ${a.name} and ${b.name} about ${mediation.scene.topic}.`, (transcript) => {
    setDraft(transcript);
    inputRef.current?.focus();
  });
  const turns = mediation.transcript.filter((e) => e.speaker === "player").length;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || mediation.awaiting) return;
    const { delivery, spoken } = voice;
    setDraft("");
    voice.setDelivery(null);
    const ok = await sendMediationMessage(text, spoken);
    if (!ok) {
      setDraft(text);
      voice.setDelivery(delivery);
    }
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form className="composer" onSubmit={(e) => void submit(e)}>
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
          placeholder={`Say something to ${first(a.name)} and ${first(b.name)}…`}
          aria-label={`Your message to ${first(a.name)} and ${first(b.name)}`}
          enterKeyHint="send"
          disabled={mediation.awaiting}
          autoFocus
        />
        {settings.voiceInput && voice.available ? <MicButton input={voice} disabled={mediation.awaiting} /> : null}
        <button type="submit" className="btn btn--primary" disabled={!draft.trim() || mediation.awaiting} data-testid="send-btn">
          Send
        </button>
      </div>
      <VoiceStatus input={voice} />
      <div className="composer__meta">
        <span className="muted small">
          {turns < MEDIATION_TURN_SOFT_CAP ? `${turns} of ~${MEDIATION_TURN_SOFT_CAP} turns` : "Time to wrap up"} · Enter to send
        </span>
        <button type="button" className="link-btn small" onClick={() => leaveMediation()} disabled={mediation.awaiting}>
          End conversation
        </button>
      </div>
    </form>
  );
}

function endText(mediation: MediationState): string {
  const [a, b] = mediation.scene.parties.map((p) => first(p.name));
  switch (mediation.endReason) {
    case "agreement":
      return `${a} and ${b} agreed: ${mediation.agreement ?? "they'll try a fairer arrangement."}`;
    case "walked_away":
      return "One of them walked off. It happens — let's see what you can learn from it.";
    case "turn_limit":
      return `${a} and ${b} had to get back to their day.`;
    default:
      return "You stepped away from the disagreement.";
  }
}

export function MediationScreen() {
  const game = useGame();
  const mediation = game.active.mediation;
  if (!mediation) {
    return (
      <div className="page">
        <p>No disagreement to mediate right now.</p>
        <button type="button" className="btn btn--primary" onClick={() => abandonMediation()}>
          Back
        </button>
      </div>
    );
  }
  const { scene } = mediation;
  const [a, b] = scene.parties;
  const lastParty = [...mediation.transcript].reverse().find((e) => e.speaker === "party");
  const hasSpoken = mediation.transcript.some((e) => e.speaker === "player");
  return (
    <div className="encounter mediation" data-testid="mediation">
      <aside className="mediation__scene" aria-label="The scene">
        <p className="eyebrow">Two locals at odds · {scene.placeName}</p>
        <h2>{scene.title}</h2>
        <p className="scene">{scene.situation}</p>
        <TensionMeter value={mediation.tension} />
        <div className="parties">
          <PartyCard party={a} trust={mediation.rapport.a} />
          <PartyCard party={b} trust={mediation.rapport.b} />
        </div>
        <p className="muted small">They're fictional characters played by AI. In real life, step in only when it's safe and welcome.</p>
      </aside>
      <section className="chat" aria-label={`Mediating between ${a.name} and ${b.name}`}>
        <header className="chat__head">
          <button
            type="button"
            className="link-btn back"
            onClick={() => {
              if (!hasSpoken || mediation.status !== "active" || window.confirm("Leave without feedback? This conversation won't count.")) abandonMediation();
            }}
          >
            ← Locals
          </button>
          <div className="chat__who">
            <div>
              <h2>
                {first(a.name)} & {first(b.name)}
              </h2>
              <p className="muted small">{scene.topic}</p>
            </div>
            {lastParty?.speaker === "party" ? <EmotionChip emotion={lastParty.emotion} /> : null}
          </div>
          <div className="chat__goal">
            <span className="tag">⚖️ Mediation</span>
            <p>
              <strong>Your goal:</strong> {scene.goal}
            </p>
          </div>
        </header>
        <Transcript mediation={mediation} />
        {mediation.status === "active" ? <Composer mediation={mediation} /> : <ReflectionForm reason={endText(mediation)} onSubmit={(rating, note) => void submitMediationReflection(rating, note)} />}
      </section>
    </div>
  );
}
