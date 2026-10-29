// Game actions: everything that changes state or talks to the server.
import { POSTCARDS } from "../../shared/destinations.ts";
import {
  HINTS_PER_ENCOUNTER,
  calibrationGap,
  encounterXp,
  initialSkillProfile,
  rankFor,
  scheduleRecall,
  updateSkill,
} from "../../shared/rules.ts";
import type { Delivery, Destination, Expedition, ExpeditionContext, NpcCard, NpcTurn, Persona, PlayerContext } from "../../shared/schemas.ts";
import { SKILL_IDS, skillLevelName } from "../../shared/skills.ts";
import { ApiError, api, setAccessCode } from "../lib/api.ts";
import { voiceLine } from "../lib/voice.ts";
import { store } from "./store.ts";
import type { DebriefResult, EncounterState, GameState, PlayerProfile, Screen, Settings, Toast } from "./types.ts";

// ── Small helpers ────────────────────────────────────────────────────────
let toastSeq = 0;

export function toast(kind: Toast["kind"], title: string, body?: string): void {
  const id = ++toastSeq;
  store.ui({ toasts: [...store.get().ui.toasts.slice(-3), { id, kind, title, body }] });
  setTimeout(() => dismissToast(id), kind === "error" ? 8000 : 5000);
}

export function dismissToast(id: number): void {
  store.ui({ toasts: store.get().ui.toasts.filter((t) => t.id !== id) });
}

export function message(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

export function go(screen: Screen): void {
  store.ui({ screen });
  window.scrollTo?.({ top: 0 });
}

const today = () => new Date().toISOString().slice(0, 10);

export function playerContext(s: GameState): PlayerContext {
  const p = s.player!;
  return {
    name: p.name,
    ageBand: p.ageBand,
    focusSkill: p.focusSkill,
    skills: Object.fromEntries(SKILL_IDS.map((id) => [id, s.progress.skills[id].rating])),
    recentScenarios: s.progress.recentScenarios.slice(-8),
  };
}

export function contextOf(e: Expedition): ExpeditionContext {
  return {
    expeditionId: e.id,
    title: e.title,
    destinationLabel: e.destination.label,
    locality: e.locality,
    scene: e.scene,
    weatherSummary: e.weather?.summary,
    greeting: e.greeting,
    notes: e.notes,
    sources: e.sources.map((s) => ({ id: s.id, title: s.title, kind: s.kind })),
  };
}

export function currentExpedition(s: GameState): Expedition | undefined {
  return s.expeditions.find((e) => e.id === s.active.expeditionId);
}

export const personKey = (expeditionId: string, npcId: string) => `${expeditionId}:${npcId}`;

// ── Boot & profile ───────────────────────────────────────────────────────
export async function loadConfig(): Promise<void> {
  try {
    const config = await api.config();
    const code = store.get().settings.accessCode;
    setAccessCode(code);
    store.ui({ config, configError: null, needsAccessCode: config.accessCodeRequired && !code });
  } catch (error) {
    store.ui({ configError: message(error) });
  }
}

export function submitAccessCode(code: string): void {
  setAccessCode(code.trim());
  store.set((s) => ({ ...s, settings: { ...s.settings, accessCode: code.trim() }, ui: { ...s.ui, needsAccessCode: false } }));
}

export function completeOnboarding(profile: PlayerProfile): void {
  store.set((s) => ({ ...s, player: profile, progress: { ...s.progress, skills: initialSkillProfile(profile.focusSkill) } }));
  go("world");
}

export function updateSettings(patch: Partial<Settings>): void {
  store.set((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
}

export function setFocusSkill(focusSkill: PlayerProfile["focusSkill"]): void {
  store.set((s) => (s.player ? { ...s, player: { ...s.player, focusSkill } } : s));
}

// ── Expeditions ──────────────────────────────────────────────────────────

export function surpriseDestination(s: GameState): Destination {
  const visited = new Set(s.atlas.map((a) => a.destination.postcardId).filter(Boolean));
  const pool = POSTCARDS.filter((p) => !visited.has(p.id));
  const card = (pool.length ? pool : POSTCARDS)[Math.floor(Math.random() * (pool.length || POSTCARDS.length))]!;
  return { lat: card.lat, lng: card.lng, label: card.name, country: card.country, postcardId: card.id, source: "surprise" };
}

export async function startExpedition(destination: Destination): Promise<void> {
  const s = store.get();
  if (s.ui.busy || !s.player) return;
  store.ui({ busy: { kind: "expedition", label: destination.label, destination: { lat: destination.lat, lng: destination.lng }, startedAt: Date.now(), progress: null, briefing: null } });
  const patchBusy = (patch: Partial<NonNullable<GameState["ui"]["busy"]>>) => {
    const busy = store.get().ui.busy;
    if (busy) store.ui({ busy: { ...busy, ...patch } });
  };
  try {
    const expedition = await api.expedition(
      { destination, player: playerContext(s) },
      {
        onProgress: (progress) => patchBusy({ progress }),
        // Two-stage arrival: read the briefing while the Game Master is still writing the locals.
        onBriefing: (briefing) => {
          patchBusy({ briefing });
          go("expedition");
        },
      },
    );
    store.set((st) => ({
      ...st,
      expeditions: [expedition, ...st.expeditions.filter((e) => e.id !== expedition.id)],
      atlas: [
        {
          expeditionId: expedition.id,
          title: expedition.title,
          destination,
          city: expedition.locality.city,
          country: expedition.locality.country,
          visitedAt: Date.now(),
          lenses: [...new Set(expedition.npcs.map((n) => n.lens))],
        },
        ...st.atlas,
      ],
      active: { expeditionId: expedition.id, personas: {}, encounter: null, debrief: null },
      ui: { ...st.ui, busy: null, screen: "expedition", personaStatus: {} },
    }));
    prefetchPersonas(expedition);
  } catch (error) {
    const briefed = Boolean(store.get().ui.busy?.briefing);
    store.ui({ busy: null });
    if (briefed) go("world");
    toast("error", "Couldn't start the expedition", message(error));
  }
}

export function openExpedition(expeditionId: string): void {
  const s = store.get();
  const expedition = s.expeditions.find((e) => e.id === expeditionId);
  if (!expedition) {
    toast("info", "That trip is no longer saved", "Start a new expedition to the same place from the world map.");
    return;
  }
  if (s.active.expeditionId !== expeditionId) {
    store.set((st) => ({ ...st, active: { expeditionId, personas: {}, encounter: null, debrief: null }, ui: { ...st.ui, personaStatus: {} } }));
  }
  go("expedition");
  prefetchPersonas(expedition);
}

const personaRequests = new Map<string, Promise<Persona>>();

export function ensurePersona(expedition: Expedition, npc: NpcCard): Promise<Persona> {
  const s = store.get();
  const known = s.active.expeditionId === expedition.id ? s.active.personas[npc.id] : undefined;
  if (known) return Promise.resolve(known);
  const met = s.people.find((p) => p.key === personKey(expedition.id, npc.id));
  if (met) return Promise.resolve(met.persona);
  const key = personKey(expedition.id, npc.id);
  const pending = personaRequests.get(key);
  if (pending) return pending;

  store.ui({ personaStatus: { ...s.ui.personaStatus, [npc.id]: "loading" } });
  const request = api
    .persona({ context: contextOf(expedition), npc, player: playerContext(s) })
    .then((persona) => {
      store.set((st) =>
        st.active.expeditionId === expedition.id
          ? { ...st, active: { ...st.active, personas: { ...st.active.personas, [npc.id]: persona } }, ui: { ...st.ui, personaStatus: { ...st.ui.personaStatus, [npc.id]: "ready" } } }
          : st,
      );
      return persona;
    })
    .catch((error: unknown) => {
      store.ui({ personaStatus: { ...store.get().ui.personaStatus, [npc.id]: "error" } });
      throw error;
    })
    .finally(() => personaRequests.delete(key));
  personaRequests.set(key, request);
  return request;
}

export function prefetchPersonas(expedition: Expedition): void {
  for (const npc of expedition.npcs) ensurePersona(expedition, npc).catch(() => {});
}

// ── Encounters ───────────────────────────────────────────────────────────
export async function meet(npcId: string): Promise<void> {
  const s = store.get();
  const expedition = currentExpedition(s);
  const npc = expedition?.npcs.find((n) => n.id === npcId);
  if (!expedition || !npc || !s.player) return;
  const person = s.people.find((p) => p.key === personKey(expedition.id, npc.id));
  try {
    const base = person?.persona ?? (await ensurePersona(expedition, npc));
    const persona = person ? { ...base, startingRapport: Math.max(base.startingRapport, Math.round(person.lastRapport * 0.8)) } : base;
    const alreadyFound = store
      .get()
      .journal.insights.filter((j) => j.key.startsWith(`${personKey(expedition.id, npc.id)}:`))
      .map((j) => j.insight.id);
    const opening: NpcTurn = {
      speaker: "npc",
      text: person ? `Oh — ${s.player.name}! You came back. ${npc.difficulty >= 3 ? "What is it this time?" : "Good to see you again."}` : persona.openingLine,
      gesture: persona.openingGesture,
      emotion: person ? "warm" : npc.difficulty === 3 ? "guarded" : npc.difficulty === 2 ? "busy" : "curious",
      rapportDelta: 0,
      rapportAfter: persona.startingRapport,
      revealedInsightIds: [],
    };
    const encounter: EncounterState = {
      id: `enc_${Date.now().toString(36)}`,
      expeditionId: expedition.id,
      npcId,
      persona,
      transcript: [opening],
      rapport: persona.startingRapport,
      startRapport: persona.startingRapport,
      unlockedInsightIds: alreadyFound,
      hints: [],
      status: "active",
      startedAt: Date.now(),
      memory: person?.memory,
      streaming: null,
      awaiting: false,
    };
    store.set((st) => ({ ...st, active: { ...st.active, encounter, debrief: null }, ui: { ...st.ui, screen: "encounter" } }));
    sayAloud(opening.text, base, expedition.id, npc.id);
  } catch (error) {
    toast("error", `Couldn't find ${npc.name}`, message(error));
  }
}

function patchEncounter(patch: (e: EncounterState) => EncounterState): void {
  store.set((s) => (s.active.encounter ? { ...s, active: { ...s.active, encounter: patch(s.active.encounter) } } : s));
}

function encounterBase(s: GameState, encounter: EncounterState) {
  const expedition = s.expeditions.find((e) => e.id === encounter.expeditionId)!;
  const npc = expedition.npcs.find((n) => n.id === encounter.npcId)!;
  return {
    context: contextOf(expedition),
    npc,
    persona: encounter.persona,
    player: playerContext(s),
    transcript: encounter.transcript,
    rapport: encounter.rapport,
    unlockedInsightIds: encounter.unlockedInsightIds,
    memory: encounter.memory,
  };
}

let turnAbort: AbortController | null = null;

/** Send the player's line; returns false if it couldn't be delivered (so the UI keeps the draft). */
/** `delivery` is how the line sounded when it was spoken (voice mode). */
export async function sendMessage(text: string, delivery?: Delivery): Promise<boolean> {
  const s = store.get();
  const encounter = s.active.encounter;
  const line = text.trim();
  if (!encounter || encounter.status !== "active" || encounter.awaiting || !line) return false;
  const request = { ...encounterBase(s, encounter), playerMessage: line, playerDelivery: delivery };
  const expedition = s.expeditions.find((e) => e.id === encounter.expeditionId)!;

  patchEncounter((e) => ({ ...e, transcript: [...e.transcript, { speaker: "player", text: line, delivery }], awaiting: true, streaming: "" }));
  turnAbort = new AbortController();
  try {
    const result = await api.turn(request, (reply) => patchEncounter((e) => ({ ...e, streaming: reply })), turnAbort.signal);
    const revealed = encounter.persona.insights.filter((i) => result.revealedInsightIds.includes(i.id));
    store.set((st) => {
      const enc = st.active.encounter;
      if (!enc || enc.id !== encounter.id) return st;
      const transcript = [...enc.transcript];
      const last = transcript[transcript.length - 1];
      if (last?.speaker === "player") transcript[transcript.length - 1] = { ...last, moves: result.moves };
      transcript.push({
        speaker: "npc",
        text: result.reply,
        gesture: result.gesture || undefined,
        emotion: result.emotion,
        rapportDelta: result.rapportDelta,
        rapportAfter: result.rapport,
        innerThought: result.innerThought,
        revealedInsightIds: result.revealedInsightIds,
        phrase: result.phrase,
      });
      const newInsights = revealed
        .filter((i) => !st.journal.insights.some((j) => j.key === `${personKey(enc.expeditionId, enc.npcId)}:${i.id}`))
        .map((insight) => ({
          key: `${personKey(enc.expeditionId, enc.npcId)}:${insight.id}`,
          insight,
          npcName: enc.persona.name,
          placeName: enc.persona.placeName,
          city: expedition.locality.city,
          country: expedition.locality.country,
          sources: expedition.sources.filter((src) => insight.sourceIds.includes(src.id)),
          foundAt: Date.now(),
          recall: { box: 1, dueAt: Date.now() },
        }));
      const phrase = result.phrase;
      const phrases =
        phrase && !st.journal.phrases.some((p) => p.text.toLowerCase() === phrase.text.toLowerCase())
          ? [{ ...phrase, language: expedition.greeting.language, from: enc.persona.name, city: expedition.locality.city, foundAt: Date.now() }, ...st.journal.phrases]
          : st.journal.phrases;
      return {
        ...st,
        journal: { ...st.journal, insights: [...newInsights, ...st.journal.insights], phrases },
        active: {
          ...st.active,
          encounter: {
            ...enc,
            transcript,
            rapport: result.rapport,
            unlockedInsightIds: [...new Set([...enc.unlockedInsightIds, ...result.revealedInsightIds])],
            awaiting: false,
            streaming: null,
            status: result.ended ? "ended" : "active",
            endReason: result.ended ? result.endReason : undefined,
          },
        },
      };
    });
    // Insights and phrases appear inline in the conversation; no toasts competing for attention.
    sayAloud(result.reply, encounter.persona, encounter.expeditionId, encounter.npcId);
    return true;
  } catch (error) {
    patchEncounter((e) => {
      const transcript = e.transcript.at(-1)?.speaker === "player" ? e.transcript.slice(0, -1) : e.transcript;
      return { ...e, transcript, awaiting: false, streaming: null };
    });
    if (!isAbort(error)) toast("error", "Message not delivered", message(error));
    return false;
  } finally {
    turnAbort = null;
  }
}

export async function requestHint(): Promise<void> {
  const s = store.get();
  const encounter = s.active.encounter;
  if (!encounter || encounter.status !== "active" || encounter.hints.length >= HINTS_PER_ENCOUNTER || s.ui.hintLoading) return;
  store.ui({ hintLoading: true });
  try {
    const hint = await api.hint(encounterBase(s, encounter));
    patchEncounter((e) => ({ ...e, hints: [...e.hints, hint] }));
  } catch (error) {
    toast("error", "The coach couldn't help just now", message(error));
  } finally {
    store.ui({ hintLoading: false });
  }
}

/** A local's line, aloud when the player has voices on. */
function sayAloud(text: string, persona: Persona, expeditionId: string, npcId: string): void {
  const s = store.get();
  if (!s.settings.voiceOutput) return;
  void voiceLine(text, { pronouns: persona.pronouns, seed: `${expeditionId}:${npcId}` }, s.ui.config?.features.voiceOutput === "model");
}

export function leaveEncounter(): void {
  turnAbort?.abort();
  patchEncounter((e) => (e.status === "active" ? { ...e, status: "ended", endReason: "left", awaiting: false, streaming: null } : e));
}

export function abandonEncounter(): void {
  turnAbort?.abort();
  store.set((s) => ({ ...s, active: { ...s.active, encounter: null } }));
  go("expedition");
}

export async function submitReflection(selfRating: number, selfNote: string): Promise<void> {
  const s = store.get();
  const encounter = s.active.encounter;
  if (!encounter || encounter.status !== "ended" || s.ui.debriefLoading) return;
  store.ui({ debriefLoading: true, debriefProgress: null });
  try {
    const base = encounterBase(s, encounter);
    const debrief = await api.debrief(
      {
        ...base,
        startRapport: encounter.startRapport,
        endReason: encounter.endReason ?? "left",
        selfRating,
        selfNote: selfNote.trim() || undefined,
      },
      { onProgress: (debriefProgress) => store.ui({ debriefProgress }) },
    );
    store.set((st) => {
      const enc = st.active.encounter;
      if (!enc || enc.id !== encounter.id) return { ...st, ui: { ...st.ui, debriefLoading: false } };
      const key = personKey(enc.expeditionId, enc.npcId);
      const foundThisTime = st.journal.insights.filter((j) => j.key.startsWith(`${key}:`) && j.foundAt >= enc.startedAt).length;
      const xp = encounterXp({
        rapportGained: enc.rapport - enc.startRapport,
        insights: foundThisTime,
        goalAchieved: debrief.goalAchieved,
        scores: debrief.scores,
        reflected: Boolean(selfNote.trim()),
      });
      const skills = { ...st.progress.skills };
      const levelUps: DebriefResult["levelUps"] = [];
      for (const id of SKILL_IDS) {
        const before = skills[id];
        const after = updateSkill(before, debrief.scores[id]);
        if (skillLevelName(after.rating) !== skillLevelName(before.rating) && after.rating > before.rating) levelUps.push({ skill: id, level: skillLevelName(after.rating) });
        skills[id] = after;
      }
      const rankBefore = rankFor(st.progress.xp).name;
      const rankAfter = rankFor(st.progress.xp + xp.total).name;
      const gap = calibrationGap(selfRating, debrief.scores);
      const npc = base.npc;
      const existing = st.people.find((p) => p.key === key);
      const expedition = st.expeditions.find((e) => e.id === enc.expeditionId);
      const mission = debrief.fieldMission;
      const result: DebriefResult = {
        encounterId: enc.id,
        npcId: enc.npcId,
        npcName: enc.persona.name,
        placeName: enc.persona.placeName,
        debrief,
        xp,
        levelUps,
        rankUp: rankAfter !== rankBefore ? rankAfter : undefined,
        selfRating,
        calibrationGap: gap,
        transcript: enc.transcript,
        insights: enc.persona.insights.filter((i) => enc.unlockedInsightIds.includes(i.id)),
      };
      return {
        ...st,
        progress: {
          ...st.progress,
          xp: st.progress.xp + xp.total,
          skills,
          calibration: gap === null ? st.progress.calibration : [...st.progress.calibration, gap].slice(-30),
          encounters: st.progress.encounters + 1,
          recentScenarios: [...st.progress.recentScenarios, npc.scenario].slice(-8),
          daily: { ...st.progress.daily, [today()]: (st.progress.daily[today()] ?? 0) + 1 },
        },
        journal: {
          ...st.journal,
          missions:
            mission.title && !st.journal.missions.some((m) => m.title === mission.title && !m.doneAt)
              ? [{ id: `m_${Date.now().toString(36)}`, ...mission, createdAt: Date.now() }, ...st.journal.missions]
              : st.journal.missions,
          reflections: [
            { id: `r_${Date.now().toString(36)}`, at: Date.now(), npcName: enc.persona.name, city: expedition?.locality.city, selfRating, selfNote: selfNote.trim() || undefined, headline: debrief.headline, question: debrief.reflectionQuestion },
            ...st.journal.reflections,
          ],
        },
        people: [
          {
            key,
            npc,
            persona: existing?.persona ?? enc.persona,
            expeditionId: enc.expeditionId,
            city: expedition?.locality.city,
            country: expedition?.locality.country,
            lastRapport: enc.rapport,
            memory: debrief.memory,
            metAt: existing?.metAt ?? Date.now(),
            visits: (existing?.visits ?? 0) + 1,
          },
          ...st.people.filter((p) => p.key !== key),
        ],
        active: { ...st.active, encounter: { ...enc, status: "debriefed" }, debrief: result },
        ui: { ...st.ui, debriefLoading: false, screen: "debrief" },
      };
    });
    const count = store.get().progress.daily[today()] ?? 0;
    if (count === 4) toast("info", "Four conversations today — great practice!", "Why not try your field mission with someone in real life next?");
  } catch (error) {
    store.ui({ debriefLoading: false });
    toast("error", "The mentor couldn't finish the debrief", message(error));
  }
}

/** Ask the mentor about the debrief; the answer streams into `ui.mentorAsking`, then joins the debrief. */
export async function askMentor(question: string): Promise<void> {
  const s = store.get();
  const result = s.active.debrief;
  const encounter = s.active.encounter;
  const q = question.trim();
  if (!q || !result || !encounter || encounter.id !== result.encounterId || s.ui.mentorAsking) return;
  const { headline, summary, strengths, growth, scores } = result.debrief;
  const history = (result.qa ?? []).map(({ question: asked, answer }) => ({ question: asked, answer }));
  store.ui({ mentorAsking: { question: q, answer: "" } });
  try {
    const reply = await api.ask({ ...encounterBase(s, encounter), debrief: { headline, summary, strengths, growth, scores }, history, question: q }, (answer) =>
      store.ui({ mentorAsking: { question: q, answer } }),
    );
    store.set((st) => {
      const debrief = st.active.debrief;
      const ui = { ...st.ui, mentorAsking: null };
      if (!debrief || debrief.encounterId !== result.encounterId) return { ...st, ui };
      return { ...st, active: { ...st.active, debrief: { ...debrief, qa: [...(debrief.qa ?? []), { question: q, ...reply }] } }, ui };
    });
  } catch (error) {
    store.ui({ mentorAsking: null });
    toast("error", "Your mentor couldn't answer", message(error));
  }
}

export function finishDebrief(): void {
  store.set((s) => ({ ...s, active: { ...s.active, encounter: null } }));
  go(currentExpedition(store.get()) ? "expedition" : "world");
}

// ── Journal ──────────────────────────────────────────────────────────────
export function answerRecall(key: string, correct: boolean): void {
  store.set((s) => ({
    ...s,
    progress: { ...s.progress, xp: s.progress.xp + (correct ? 5 : 0) },
    journal: {
      ...s.journal,
      insights: s.journal.insights.map((j) => (j.key === key ? { ...j, recall: scheduleRecall(j.recall, correct, Date.now()) } : j)),
    },
  }));
}

export function toggleMission(id: string): void {
  store.set((s) => ({
    ...s,
    progress: { ...s.progress, xp: s.progress.xp + (s.journal.missions.find((m) => m.id === id && !m.doneAt) ? 20 : 0) },
    journal: { ...s.journal, missions: s.journal.missions.map((m) => (m.id === id ? { ...m, doneAt: m.doneAt ? undefined : Date.now() } : m)) },
  }));
}

export function answerReflection(id: string, answer: string): void {
  store.set((s) => ({ ...s, journal: { ...s.journal, reflections: s.journal.reflections.map((r) => (r.id === id ? { ...r, answer } : r)) } }));
}

export function revisitPerson(key: string): void {
  const person = store.get().people.find((p) => p.key === key);
  if (!person) return;
  openExpedition(person.expeditionId);
}
