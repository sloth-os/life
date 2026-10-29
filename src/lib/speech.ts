// Optional voice mode via the browser's Web Speech API (no extra services).

interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const canListen = (): boolean => typeof window !== "undefined" && Boolean(recognitionCtor());
export const canSpeak = (): boolean => typeof window !== "undefined" && "speechSynthesis" in window;

/** Start dictation; returns a stop function. `onText` receives the running transcript. */
export function listen(onText: (text: string, final: boolean) => void, onEnd: (error?: string) => void, lang = navigator.language || "en-US"): () => void {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    onEnd("unsupported");
    return () => {};
  }
  const recognition = new Ctor();
  recognition.lang = lang;
  recognition.continuous = false;
  recognition.interimResults = true;
  let finalText = "";
  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]!;
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    onText((finalText + interim).trim(), interim === "");
  };
  recognition.onerror = (event) => onEnd(event.error);
  recognition.onend = () => onEnd();
  recognition.start();
  return () => recognition.stop();
}

export function speak(text: string, lang = "en-US"): void {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}
