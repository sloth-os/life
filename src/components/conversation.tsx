// Pieces shared by the two kinds of conversation (a local, or a mediation between two):
// speaking a message through the voice model, how a spoken line sounded, and the reflection
// before the mentor's feedback.
import { useEffect, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { Delivery, Heard } from "../../shared/schemas.ts";
import { api } from "../lib/api.ts";
import { canRecord, startRecording, type Recording } from "../lib/recorder.ts";
import { message, toast } from "../state/actions.ts";
import { useGame } from "../state/store.ts";
import { Spinner, formatElapsed, useElapsed } from "./ui.tsx";
import { t, type MessageKey } from "../i18n/index.ts";

/**
 * Enter sends and Shift+Enter starts a new line. An Enter the input method is still using, to pick
 * Chinese characters for example, doesn't send: `isComposing`, or keyCode 229, which Safari
 * reports for the Enter that confirms a candidate.
 */
export function isSendKey(event: KeyboardEvent<HTMLTextAreaElement>) {
  return event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229;
}

export const TONE_ICONS: Record<Delivery["tone"], string> = { warm: "🤗", friendly: "🙂", neutral: "😐", hesitant: "🤔", tense: "😬", flat: "😶", impatient: "⏩" };

/** How a spoken line sounded. */
export function DeliveryChip({ delivery }: { delivery: Delivery }) {
  return (
    <p className="delivery" title={delivery.note}>
      🎙 {t("voice.spokenChip", { tone: `${TONE_ICONS[delivery.tone]} ${t(`tone.${delivery.tone}` as MessageKey)}`, pace: t(`pace.${delivery.pace}` as MessageKey) })}
    </p>
  );
}

type VoiceState = { kind: "idle" } | { kind: "recording"; recording: Recording; startedAt: number } | { kind: "hearing" };

/**
 * Speak a message through the server's voice model: record, then the model hears what was said
 * (into `onHeard`, word by word as the model writes it, then once more with `final`) and how it
 * sounded (kept as `delivery` until the message is sent or discarded).
 */
export function useVoiceInput(context: string, onHeard: (transcript: string, final: boolean) => void) {
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
      // The words go into the message box as they arrive, so the player can check them while the
      // model is still writing how they sounded.
      let streamed = false;
      const heard = await api.listen({ audio: audio.base64, context }, (words) => {
        streamed = true;
        onHeard(words, false);
      });
      if (!heard.transcript.trim()) {
        // Nothing heard: what the player had typed stays, unless words already replaced it.
        if (streamed) onHeard("", true);
        toast("info", t("voice.didntCatch"), t("voice.closer"));
      } else {
        onHeard(heard.transcript, true);
        setDelivery(heard);
      }
    } catch (error) {
      toast("error", t("voice.couldntHear"), message(error));
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
      toast("error", t("voice.noMic"), error instanceof DOMException && error.name === "NotAllowedError" ? t("voice.allowMic") : message(error));
    }
  };

  /** The delivery to send with the message, if it was spoken. */
  const spoken: Delivery | undefined = delivery ? { tone: delivery.tone, pace: delivery.pace, clarity: delivery.clarity, note: delivery.note } : undefined;
  return { available, voice, level, seconds, delivery, spoken, setDelivery, toggle, hearing: voice.kind === "hearing" };
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
      aria-label={voice.kind === "recording" ? t("voice.stop") : t("composer.speak")}
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
        ● {t("voice.recording", { time: formatElapsed(seconds) })}
      </p>
    );
  }
  if (voice.kind === "hearing") {
    return (
      <p className="voice-status" role="status">
        {t("voice.listening")}
      </p>
    );
  }
  if (!delivery) return null;
  return (
    <p className="voice-status" role="status" data-testid="heard">
      {TONE_ICONS[delivery.tone]} {t("voice.youSounded", { tone: t(`tone.${delivery.tone}` as MessageKey), pace: t(`pace.${delivery.pace}` as MessageKey) })} {delivery.note}
      <button type="button" className="link-btn small" onClick={() => input.setDelivery(null)}>
        {t("voice.sendAsTyped")}
      </button>
    </p>
  );
}

const RATING_LABELS: MessageKey[] = ["rating.1", "rating.2", "rating.3", "rating.4", "rating.5"];

/** Self-assessment first, then the mentor's feedback (with live progress while it is written). */
export function ReflectionForm({ reason, onSubmit }: { reason: string; onSubmit: (rating: number, note: string) => void }) {
  const { debriefLoading: loading, debriefProgress: progress } = useGame().ui;
  const [startedAt, setStartedAt] = useState<number | null>(null);
  useEffect(() => setStartedAt(loading ? Date.now() : null), [loading]);
  const elapsed = useElapsed(startedAt);
  const doing = progress?.phase === "writing" ? t("mentor.writing") : progress?.thinking ? t("mentor.thinking") : t("mentor.reviewing");
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
        <h3>{t("reflect.title")}</h3>
        <p>{t("reflect.question")}</p>
        <div className="stars" role="radiogroup" aria-label={t("reflect.selfRating")}>
          {RATING_LABELS.map((label, i) => (
            <button key={label} type="button" role="radio" aria-checked={rating === i + 1} className={rating >= i + 1 ? "is-on" : ""} onClick={() => setRating(i + 1)} data-testid={`rate-${i + 1}`}>
              <span aria-hidden="true">★</span>
              <span className="stars__label">{t(label)}</span>
            </button>
          ))}
        </div>
        <label className="field">
          <span>{t("reflect.differently")}</span>
          <textarea value={note} maxLength={400} rows={2} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className="btn btn--primary" disabled={!rating || loading} data-testid="get-feedback">
          {loading ? <Spinner label={`${doing} ${formatElapsed(elapsed)}`} /> : t("reflect.getFeedback")}
        </button>
      </form>
    </div>
  );
}
