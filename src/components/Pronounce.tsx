import { useState } from "react";
import type { PronunciationResult } from "../../shared/schemas.ts";
import { api } from "../lib/api.ts";
import { canRecord, startRecording, type Recording } from "../lib/recorder.ts";
import { message, toast } from "../state/actions.ts";
import { useGame } from "../state/store.ts";
import { Spinner } from "./ui.tsx";
import { t } from "../i18n/index.ts";

/**
 * Practise saying a phrase: record an attempt and the voice model scores how close it came,
 * with one tip. Shown only when the server has a voice model and the browser can record.
 */
export function PronounceButton({ phrase, language, meaning }: { phrase: string; language: string; meaning?: string }) {
  const config = useGame().ui.config;
  const [state, setState] = useState<{ kind: "idle" } | { kind: "recording"; recording: Recording } | { kind: "scoring" }>({ kind: "idle" });
  const [result, setResult] = useState<PronunciationResult | null>(null);
  if (!config?.features.voice || !canRecord()) return null;

  const stop = async (recording: Recording) => {
    setState({ kind: "scoring" });
    try {
      const audio = await recording.stop();
      setResult(await api.pronounce({ audio: audio.base64, phrase, language, meaning }));
    } catch (error) {
      toast("error", t("pronounce.failed"), message(error));
    } finally {
      setState({ kind: "idle" });
    }
  };

  const toggle = async () => {
    if (state.kind === "recording") return stop(state.recording);
    if (state.kind !== "idle") return;
    try {
      let recording: Recording | null = null;
      recording = await startRecording(undefined, () => {
        if (recording) void stop(recording);
      });
      setResult(null);
      setState({ kind: "recording", recording });
    } catch (error) {
      toast("error", t("voice.noMic"), message(error));
    }
  };

  const band = result ? (result.score >= 80 ? "great" : result.score >= 55 ? "close" : "keep-going") : "";
  return (
    <div className="pronounce">
      <button
        type="button"
        className={`btn btn--small${state.kind === "recording" ? " is-recording" : ""}`}
        onClick={() => void toggle()}
        disabled={state.kind === "scoring"}
        aria-pressed={state.kind === "recording"}
        data-testid="pronounce-btn"
      >
        {state.kind === "recording" ? `● ${t("pronounce.stop")}` : state.kind === "scoring" ? <Spinner label={t("pronounce.listening")} /> : `🎙 ${t("pronounce.practise")}`}
      </button>
      {result ? (
        <p className={`pronounce__result pronounce__result--${band}`} role="status" data-testid="pronounce-result">
          <strong>{result.score}/100</strong> {result.tip}
          {result.transcript ? <span className="muted small"> {t("pronounce.heard", { text: result.transcript })}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
