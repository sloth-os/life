// Pieces shared by the two kinds of conversation (a local, or a mediation between two):
// speaking a message through the voice model, how a spoken line sounded, and the reflection
// before the mentor's feedback.
import { useEffect, useState, type CSSProperties } from "react";
import type { Delivery, Heard } from "../../shared/schemas.ts";
import { api } from "../lib/api.ts";
import { canRecord, startRecording, type Recording } from "../lib/recorder.ts";
import { message, toast } from "../state/actions.ts";
import { useGame } from "../state/store.ts";
import { Spinner, formatElapsed, useElapsed } from "./ui.tsx";

export const TONE_ICONS: Record<Delivery["tone"], string> = { warm: "🤗", friendly: "🙂", neutral: "😐", hesitant: "🤔", tense: "😬", flat: "😶", impatient: "⏩" };

/** How a spoken line sounded. */
export function DeliveryChip({ delivery }: { delivery: Delivery }) {
  return (
    <p className="delivery" title={delivery.note}>
      🎙 Spoken · {TONE_ICONS[delivery.tone]} {delivery.tone} · {delivery.pace} pace
    </p>
  );
}

type VoiceState = { kind: "idle" } | { kind: "recording"; recording: Recording; startedAt: number } | { kind: "hearing" };

/**
 * Speak a message through the server's voice model: record, then the model hears what was said
 * (into `onHeard`) and how it sounded (kept as `delivery` until the message is sent or discarded).
 */
export function useVoiceInput(context: string, onHeard: (transcript: string) => void) {
  const config = useGame().ui.config;
  const available = Boolean(config?.features.voice) && canRecord();
  const [voice, setVoice] = useState<VoiceState>({ kind: "idle" });
  const [delivery, setDelivery] = useState<Heard | null>(null);
  const [level, setLevel] = useState(0);
  const seconds = useElapsed(voice.kind === "recording" ? voice.startedAt : null);

  const stop = async (recording: Recording) => {
    setVoice({ kind: "hearing" });
    setLevel(0);
    try {
      const audio = await recording.stop();
      const heard = await api.listen({ audio: audio.base64, context });
      if (!heard.transcript.trim()) {
        toast("info", "I didn't catch that", "Try again a little closer to the microphone.");
      } else {
        onHeard(heard.transcript);
        setDelivery(heard);
      }
    } catch (error) {
      toast("error", "Couldn't hear that", message(error));
    } finally {
      setVoice({ kind: "idle" });
    }
  };

  const toggle = async () => {
    if (voice.kind === "recording") return stop(voice.recording);
    if (voice.kind !== "idle") return;
    try {
      let recording: Recording | null = null;
      recording = await startRecording(setLevel, () => {
        if (recording) void stop(recording);
      });
      setVoice({ kind: "recording", recording, startedAt: Date.now() });
    } catch (error) {
      toast("error", "The microphone isn't available", error instanceof DOMException && error.name === "NotAllowedError" ? "Allow microphone access for this site to speak to locals." : message(error));
    }
  };

  /** The delivery to send with the message, if it was spoken. */
  const spoken: Delivery | undefined = delivery ? { tone: delivery.tone, pace: delivery.pace, clarity: delivery.clarity, note: delivery.note } : undefined;
  return { available, voice, level, seconds, delivery, spoken, setDelivery, toggle };
}

export type VoiceInput = ReturnType<typeof useVoiceInput>;

export function MicButton({ input, disabled }: { input: VoiceInput; disabled?: boolean }) {
  const { voice, level } = input;
  return (
    <button
      type="button"
      className={`icon-btn mic${voice.kind === "recording" ? " is-on" : ""}`}
      onClick={() => void input.toggle()}
      disabled={voice.kind === "hearing" || disabled}
      aria-pressed={voice.kind === "recording"}
      aria-label={voice.kind === "recording" ? "Stop recording" : "Speak your message"}
      data-testid="mic-btn"
      style={{ "--level": level } as CSSProperties}
    >
      {voice.kind === "hearing" ? <Spinner /> : "🎙️"}
    </button>
  );
}

/** Recording, listening, or how the last recording sounded (with a way to send it as typed). */
export function VoiceStatus({ input }: { input: VoiceInput }) {
  const { voice, seconds, delivery } = input;
  if (voice.kind === "recording") {
    return (
      <p className="voice-status" role="status">
        ● Recording {formatElapsed(seconds)} — tap the microphone again when you're done
      </p>
    );
  }
  if (voice.kind === "hearing") {
    return (
      <p className="voice-status" role="status">
        Listening to how you said it…
      </p>
    );
  }
  if (!delivery) return null;
  return (
    <p className="voice-status" role="status" data-testid="heard">
      {TONE_ICONS[delivery.tone]} You sounded {delivery.tone}, at a {delivery.pace} pace. {delivery.note}
      <button type="button" className="link-btn small" onClick={() => input.setDelivery(null)}>
        Send as typed
      </button>
    </p>
  );
}

const RATING_LABELS = ["Rough", "Shaky", "Okay", "Good", "Great"];

/** Self-assessment first, then the mentor's feedback (with live progress while it is written). */
export function ReflectionForm({ reason, onSubmit }: { reason: string; onSubmit: (rating: number, note: string) => void }) {
  const { debriefLoading: loading, debriefProgress: progress } = useGame().ui;
  const [startedAt, setStartedAt] = useState<number | null>(null);
  useEffect(() => setStartedAt(loading ? Date.now() : null), [loading]);
  const elapsed = useElapsed(startedAt);
  const doing = progress?.phase === "writing" ? "Your mentor is writing your feedback…" : progress?.thinking ? "Your mentor is thinking it over…" : "Your mentor is reviewing the conversation…";
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState("");
  return (
    <div className="ended">
      <p className="ended__reason" role="status">
        {reason}
      </p>
      <form
        className="reflect"
        onSubmit={(e) => {
          e.preventDefault();
          if (rating) onSubmit(rating, note);
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
          {loading ? <Spinner label={`${doing} ${formatElapsed(elapsed)}`} /> : "Get feedback"}
        </button>
      </form>
    </div>
  );
}
