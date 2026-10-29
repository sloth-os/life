// The locals' voices: the server's voice model when the game has one (a consistent voice per
// local), otherwise the browser's built-in speech. One line plays at a time.
import { ApiError, api } from "./api.ts";
import { canSpeak, speak as browserSpeak, stopSpeaking as browserStop } from "./speech.ts";

let pending: AbortController | null = null;
let currentUrl: string | null = null;
/** Set when the server's voice model turned out not to speak: the browser takes over. */
let modelSilent = false;

/** The one audio element voices play through (hidden; tests read its state). */
function player(): HTMLAudioElement {
  let el = document.getElementById("voice-player") as HTMLAudioElement | null;
  if (!el) {
    el = document.createElement("audio");
    el.id = "voice-player";
    el.hidden = true;
    document.body.append(el);
  }
  return el;
}

export function stopVoice(): void {
  pending?.abort();
  pending = null;
  const el = document.getElementById("voice-player") as HTMLAudioElement | null;
  el?.pause();
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = null;
  browserStop();
}

export interface Speaker {
  pronouns?: string;
  /** Keeps a local's voice the same all conversation (expedition and local ids). */
  seed?: string;
  /** BCP 47 language for the browser fallback. */
  lang?: string;
}

/** Say a local's line aloud. Resolves once playback has started (or failed quietly). */
export async function voiceLine(text: string, speaker: Speaker, serverVoice: boolean): Promise<void> {
  stopVoice();
  if (!serverVoice || modelSilent) {
    if (canSpeak()) browserSpeak(text, speaker.lang);
    return;
  }
  const controller = new AbortController();
  pending = controller;
  try {
    const audio = await api.speak({ text, pronouns: speaker.pronouns, seed: speaker.seed }, controller.signal);
    if (controller.signal.aborted) return;
    const el = player();
    currentUrl = URL.createObjectURL(audio);
    el.src = currentUrl;
    el.dataset.line = text.slice(0, 80);
    await el.play();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    if (error instanceof ApiError && error.code === "voice_cannot_speak") modelSilent = true;
    // Voice is a nice-to-have: fall back to the browser rather than interrupt the conversation.
    if (canSpeak()) browserSpeak(text, speaker.lang);
  } finally {
    if (pending === controller) pending = null;
  }
}
