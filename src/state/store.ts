import { useSyncExternalStore } from "react";
import { MAPS_COORDINATE_RETENTION_MS, initialSkillProfile } from "../../shared/rules.ts";
import { SKILL_IDS } from "../../shared/skills.ts";
import type { GameState, SaveData, UiState } from "./types.ts";

const SAVE_KEY = "common-ground:save:v1";
const MAX_EXPEDITIONS = 12;

export function defaultSave(): SaveData {
  return {
    version: 1,
    player: null,
    settings: { voiceInput: false, voiceOutput: false, textScale: 1, reducedMotion: false, theme: "system", accessCode: "" },
    progress: { xp: 0, skills: initialSkillProfile(), calibration: [], encounters: 0, recentScenarios: [], daily: {} },
    journal: { insights: [], phrases: [], missions: [], reflections: [] },
    people: [],
    atlas: [],
    expeditions: [],
    active: { expeditionId: null, personas: {}, encounter: null, debrief: null },
  };
}

/**
 * Google Maps Platform terms allow caching place coordinates for at most 30
 * days. Saved Google-mode expeditions lose their locals' coordinates after
 * that (the player's own destination coordinates are theirs to keep).
 */
export function purgeExpiredMapsContent(save: SaveData, now = Date.now()): SaveData {
  const expired = (createdAt: number) => now - createdAt > MAPS_COORDINATE_RETENTION_MS;
  // A destination picked from Google search results has Google coordinates too.
  const googleDestination = (d: { source: string; mapsUrl?: string }) => d.source === "search" && Boolean(d.mapsUrl);
  return {
    ...save,
    expeditions: save.expeditions
      .filter((e) => !(e.mapsMode === "google" && googleDestination(e.destination) && expired(e.createdAt)))
      .map((e) => (e.mapsMode === "google" && expired(e.createdAt) ? { ...e, npcs: e.npcs.map(({ location: _drop, ...npc }) => npc) } : e)),
    people: save.people.map((p) => (p.npc.location && p.npc.mapsUrl && expired(p.metAt) ? { ...p, npc: { ...p.npc, location: undefined } } : p)),
    atlas: save.atlas.map((a) =>
      googleDestination(a.destination) && expired(a.visitedAt) && !a.coordinatesExpired
        ? { ...a, destination: { ...a.destination, lat: 0, lng: 0 }, coordinatesExpired: true }
        : a,
    ),
  };
}

function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw) as SaveData;
    if (parsed.version !== 1) return defaultSave();
    const base = defaultSave();
    const merged: SaveData = {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...parsed.settings },
      progress: { ...base.progress, ...parsed.progress, skills: { ...base.progress.skills, ...parsed.progress?.skills } },
      journal: { ...base.journal, ...parsed.journal },
      active: { ...base.active, ...parsed.active },
    };
    for (const id of SKILL_IDS) merged.progress.skills[id] ??= base.progress.skills[id];
    // A reload mid-reply leaves the player's last line unanswered: drop it so they can resend.
    const encounter = merged.active.encounter;
    if (encounter?.awaiting) {
      const transcript = encounter.transcript.at(-1)?.speaker === "player" ? encounter.transcript.slice(0, -1) : encounter.transcript;
      merged.active.encounter = { ...encounter, transcript, awaiting: false, streaming: null };
    }
    return purgeExpiredMapsContent(merged);
  } catch {
    return defaultSave();
  }
}

function toSave(state: GameState): SaveData {
  const { ui: _ui, ...save } = state;
  return { ...save, expeditions: save.expeditions.slice(0, MAX_EXPEDITIONS) };
}

const initialUi: UiState = {
  screen: "title",
  config: null,
  configError: null,
  toasts: [],
  busy: null,
  personaStatus: {},
  hintLoading: false,
  debriefLoading: false,
  debriefProgress: null,
  mentorAsking: null,
  needsAccessCode: false,
};

type Listener = () => void;
let state: GameState = { ...loadSave(), ui: initialUi };
const listeners = new Set<Listener>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function persist(): void {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(toSave(state)));
  } catch {
    // Storage can be full or blocked (private mode); the game still works this session.
  }
}

// Saves are debounced; flush a pending one when the page is hidden or unloaded, so a quick
// reload, a closed tab or a phone discarding a background tab never loses progress.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => saveTimer && persist());
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && saveTimer && persist());
}

export const store = {
  get: (): GameState => state,
  set(update: (s: GameState) => GameState): void {
    state = update(state);
    for (const l of listeners) l();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 250);
  },
  ui(patch: Partial<UiState>): void {
    store.set((s) => ({ ...s, ui: { ...s.ui, ...patch } }));
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  reset(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // ignore
    }
    store.set((s) => ({ ...defaultSave(), ui: { ...initialUi, config: s.ui.config, screen: "title" } }));
  },
  exportJson(): string {
    return JSON.stringify(toSave(state), null, 2);
  },
};

export function useGame(): GameState {
  return useSyncExternalStore(store.subscribe, store.get);
}
