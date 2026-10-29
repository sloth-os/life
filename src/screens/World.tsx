import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { POSTCARDS, type Postcard } from "../../shared/destinations.ts";
import { rankFor } from "../../shared/rules.ts";
import type { Destination, ExpeditionBriefing, GeoResult, StreamProgress } from "../../shared/schemas.ts";
import { SKILLS } from "../../shared/skills.ts";
import { LENSES, SCENARIOS } from "../../shared/world.ts";
import { PronounceButton } from "../components/Pronounce.tsx";
import { Avatar, Difficulty, LensTag, SourceList, Spinner, formatCount, formatElapsed, useElapsed } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { canSpeak, speak } from "../lib/speech.ts";
import { startFlyIn, type FlyIn } from "../map/flyin.ts";
import { useMap } from "../map/index.ts";
import type { MapMarker } from "../map/types.ts";
import { currentExpedition, ensurePersona, go, meet, personKey, startExpedition, startMediation, surpriseDestination, toast } from "../state/actions.ts";
import { useGame } from "../state/store.ts";
import { continentName, placeName, postcardText, rankName, scenarioName, skillName, t, type MessageKey } from "../i18n/index.ts";

const CONTINENTS: Postcard["continent"][] = ["Africa", "Asia", "Europe", "North America", "South America", "Oceania"];

function postcardDestination(p: Postcard): Destination {
  return { lat: p.lat, lng: p.lng, label: p.name, country: p.country, postcardId: p.id, source: "postcard" };
}

function dailySuggestion(visited: Set<string>): Postcard {
  const pool = POSTCARDS.filter((p) => !visited.has(p.id));
  const list = pool.length ? pool : POSTCARDS;
  const day = Math.floor(Date.now() / 86_400_000);
  return list[day % list.length]!;
}

export function WorldScreen() {
  const game = useGame();
  const map = useMap();
  const [selected, setSelected] = useState<Destination | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const config = game.ui.config!;
  const visited = useMemo(() => new Set(game.atlas.map((a) => a.destination.postcardId).filter((id): id is string => Boolean(id))), [game.atlas]);
  const suggestion = dailySuggestion(visited);
  const rank = rankFor(game.progress.xp);
  const focus = SKILLS[game.player!.focusSkill];
  const searchEnabled = config.mapsMode === "open" || config.placeGrounding === "google";

  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = POSTCARDS.map((p) => ({
      id: `postcard:${p.id}`,
      position: { lat: p.lat, lng: p.lng },
      kind: visited.has(p.id) ? "visited" : "postcard",
      label: postcardText(p).name,
      glyph: visited.has(p.id) ? "✓" : LENSES[p.lenses[0]!].icon,
      color: visited.has(p.id) ? "var(--accent-2)" : "var(--accent)",
      selected: selected?.postcardId === p.id,
    }));
    for (const entry of game.atlas) {
      if (entry.destination.postcardId || entry.coordinatesExpired) continue;
      list.push({ id: `atlas:${entry.expeditionId}`, position: entry.destination, kind: "visited", label: entry.city ?? entry.destination.label, glyph: "✓", color: "var(--accent-2)" });
    }
    if (selected && !selected.postcardId) list.push({ id: "pin", position: selected, kind: "pin", label: selected.label, glyph: "📍", color: "var(--accent)", selected: true });
    return list;
  }, [visited, game.atlas, selected, game.settings.language]);

  useEffect(() => {
    map.run((m) => {
      m.setMarkers(markers);
      m.setHandlers({
        onMarker: (id) => {
          if (id.startsWith("postcard:")) {
            const card = POSTCARDS.find((p) => `postcard:${p.id}` === id);
            if (card) setSelected(postcardDestination(card));
          }
        },
        onMap: (position) => setSelected({ ...position, label: `Pin at ${position.lat.toFixed(2)}, ${position.lng.toFixed(2)}`, source: "pin" }),
      });
    });
  }, [map, markers]);

  const didFly = useRef(false);
  useEffect(() => {
    if (didFly.current) return;
    didFly.current = true;
    map.run((m) => m.fitTo(POSTCARDS.map((p) => ({ lat: p.lat, lng: p.lng })), 3));
  }, [map]);

  const choose = (destination: Destination) => {
    setSelected(destination);
    map.run((m) => m.flyTo(destination, destination.source === "pin" ? 6 : 5));
  };

  const search = async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      const { results: found } = await api.search(q);
      setResults(found);
    } catch (error) {
      toast("error", t("world.searchFailed"), error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  };

  const postcard = selected?.postcardId ? POSTCARDS.find((p) => p.id === selected.postcardId) : undefined;

  return (
    <div className="map-screen">
      <aside className="side-panel" aria-label={t("world.chooseDestination")}>
        <div className="side-panel__scroll">
          <header className="hello">
            <h2>{t("world.whereNext", { name: game.player!.name })}</h2>
            <p className="muted">
              {rankName(rank.name)} · {t("world.focus")} {focus.icon} {skillName(game.player!.focusSkill)}{" "}
              <button type="button" className="link-btn" onClick={() => go("compass")}>
                {t("world.change")}
              </button>
            </p>
          </header>

          {selected ? (
            <div className="travel-card" data-testid="travel-card">
              <p className="eyebrow">{selected.source === "pin" ? t("world.droppedPin") : postcard ? t("world.postcardOf", { continent: continentName(postcard.continent) }) : t("world.destination")}</p>
              <h3>{placeName(selected)}</h3>
              {postcard ? <p>{postcardText(postcard).theme}</p> : selected.source === "pin" ? <p>{t("world.pinGuide")}</p> : <p>{selected.country}</p>}
              {postcard ? (
                <p className="tags">
                  {postcard.lenses.map((l) => (
                    <LensTag key={l} lens={l} />
                  ))}
                </p>
              ) : null}
              <div className="row">
                <button type="button" className="btn btn--primary" onClick={() => void startExpedition(selected)} disabled={Boolean(game.ui.busy)}>
                  {t("world.travelHere")}
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setSelected(null)}>
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <div className="suggestion">
              <p className="eyebrow">{t("world.todaysPostcard")}</p>
              <button type="button" className="suggestion__card" onClick={() => choose(postcardDestination(suggestion))}>
                <strong>
                  {postcardText(suggestion).name}, {postcardText(suggestion).country}
                </strong>
                <span>{postcardText(suggestion).theme}</span>
              </button>
              <div className="row">
                <button type="button" className="btn" onClick={() => choose(surpriseDestination(game))}>
                  🎲 {t("world.surprise")}
                </button>
              </div>
            </div>
          )}

          <form
            className="search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <label htmlFor="go-anywhere" className="eyebrow">
              {t("world.goAnywhere")}
            </label>
            {searchEnabled ? (
              <div className="search__row">
                <input id="go-anywhere" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("world.searchPlaceholder")} />
                <button type="submit" className="btn" disabled={searching || query.trim().length < 2}>
                  {searching ? <Spinner /> : t("world.search")}
                </button>
              </div>
            ) : (
              <p className="muted small">{t("world.searchNeedsTools")}</p>
            )}
            <p className="muted small">{t("world.orPin")}</p>
            {results ? (
              <ul className="results">
                {results.length === 0 ? <li className="muted">{t("world.noPlaces")}</li> : null}
                {results.map((r, i) => (
                  <li key={`${r.lat},${r.lng},${i}`}>
                    <button type="button" onClick={() => choose({ lat: r.lat, lng: r.lng, label: r.label, country: r.sublabel?.split(", ").at(-1), source: "search", mapsUrl: r.mapsUrl, query: query.trim() })}>
                      <strong>{r.label}</strong>
                      {r.sublabel ? <span className="muted"> · {r.sublabel}</span> : null}
                    </button>
                  </li>
                ))}
                {results.length ? <li className="muted small">{t("world.results", { attribution: results[0]!.attribution })}</li> : null}
              </ul>
            ) : null}
          </form>

          <section className="postcards" aria-label={t("world.postcards")}>
            <p className="eyebrow">{t("world.postcardsTitle")}</p>
            {CONTINENTS.map((continent) => (
              <details key={continent} open={continent === "Africa" || continent === "Asia"}>
                <summary>{continentName(continent)}</summary>
                <ul>
                  {POSTCARDS.filter((p) => p.continent === continent).map((p) => (
                    <li key={p.id}>
                      <button type="button" className={`postcard-row${selected?.postcardId === p.id ? " is-on" : ""}`} onClick={() => choose(postcardDestination(p))}>
                        <span className="postcard-row__name">
                          {visited.has(p.id) ? "✓ " : ""}
                          {postcardText(p).name}
                          <span className="muted"> · {postcardText(p).country}</span>
                        </span>
                        <span className="postcard-row__theme">{postcardText(p).theme}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </section>
        </div>
      </aside>
    </div>
  );
}

export function ExpeditionScreen() {
  const game = useGame();
  const map = useMap();
  const expedition = currentExpedition(game);
  const [highlight, setHighlight] = useState<string | null>(null);

  useEffect(() => {
    if (!expedition) return;
    const markers: MapMarker[] = expedition.npcs.map((n) => {
      const met = game.people.find((p) => p.key === personKey(expedition.id, n.id));
      return {
        id: n.id,
        position: n.location ?? expedition.destination,
        kind: "npc",
        label: `${n.name} · ${n.placeName}`,
        glyph: met ? "★" : n.name.slice(0, 1),
        color: LENSES[n.lens].color,
        selected: highlight === n.id,
      };
    });
    map.run((m) => {
      m.setMarkers(markers);
      m.setHandlers({
        onMarker: (id) => {
          setHighlight(id);
          document.getElementById(`local-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        },
      });
    });
  }, [map, expedition, game.people, highlight]);

  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!expedition || fitted.current === expedition.id) return;
    fitted.current = expedition.id;
    const points = expedition.npcs.map((n) => n.location).filter((p): p is NonNullable<typeof p> => Boolean(p));
    map.run((m) => m.fitTo(points.length ? [...points, expedition.destination] : [expedition.destination], 16));
  }, [map, expedition]);

  if (!expedition) {
    return (
      <div className="map-screen">
        <aside className="side-panel">
          <div className="side-panel__scroll">
            <p>{t("expedition.none")}</p>
            <button type="button" className="btn btn--primary" onClick={() => go("world")}>
              {t("expedition.backToMap")}
            </button>
          </div>
        </aside>
      </div>
    );
  }

  const unfinished = game.active.encounter && game.active.encounter.expeditionId === expedition.id && game.active.encounter.status !== "debriefed" ? game.active.encounter : null;

  return (
    <div className="map-screen">
      <aside className="side-panel" aria-label={t("expedition.label", { title: expedition.title })}>
        <div className="side-panel__scroll">
          <button type="button" className="link-btn back" onClick={() => go("world")}>
            ← {t("expedition.worldMap")}
          </button>
          {unfinished ? (
            <div className="resume" role="status">
              <span>
                {unfinished.status === "active" ? t("expedition.wereTalking", { name: unfinished.persona.name }) : t("expedition.awaitingReflection", { name: unfinished.persona.name })}
              </span>
              <button type="button" className="btn btn--primary btn--small" onClick={() => go("encounter")}>
                {t("common.continue")}
              </button>
            </div>
          ) : null}
          <BriefingHeader briefing={expedition} />

          <section aria-label={t("expedition.locals")}>
            <p className="eyebrow">{t("expedition.peopleToMeet")}</p>
            <ul className="locals">
              {expedition.npcs.map((npc) => {
                const status = game.ui.personaStatus[npc.id];
                const met = game.people.find((p) => p.key === personKey(expedition.id, npc.id));
                const ready = Boolean(game.active.personas[npc.id]) || Boolean(met);
                const scenario = SCENARIOS[npc.scenario];
                return (
                  <li key={npc.id} id={`local-${npc.id}`} className={`local-card${highlight === npc.id ? " is-highlighted" : ""}`} style={{ "--lens-color": LENSES[npc.lens].color } as CSSProperties}>
                    <div className="local-card__head">
                      <Avatar name={npc.name} hue={npc.hue} />
                      <div>
                        <h3>
                          {npc.name}, {npc.age}
                        </h3>
                        <p className="muted small">
                          {npc.role} · {npc.mapsUrl ? (
                            <a href={npc.mapsUrl} target="_blank" rel="noreferrer" title={t("expedition.openInMaps")}>
                              {npc.placeName}
                            </a>
                          ) : (
                            npc.placeName
                          )}
                        </p>
                      </div>
                    </div>
                    <p className="local-card__hook">“{npc.hook}”</p>
                    {npc.walk ? (
                      <p className="muted small" title={t("expedition.walkSource")}>
                        🚶 {t("expedition.walk", { minutes: npc.walk.minutes })} · <span translate="no">Google Maps</span>
                      </p>
                    ) : null}
                    <p className="tags">
                      <LensTag lens={npc.lens} />
                      <span className="tag">
                        {scenario.icon} {scenarioName(npc.scenario)}
                      </span>
                      <Difficulty level={npc.difficulty} />
                    </p>
                    <p className="local-card__goal">
                      <strong>{t("expedition.goal")}</strong> {npc.goal}
                    </p>
                    <div className="row">
                      {met ? <span className="muted small">{t("expedition.met", { rapport: Math.round(met.lastRapport) })}</span> : null}
                      {status === "error" && !ready ? (
                        <button type="button" className="btn" onClick={() => void ensurePersona(expedition, npc).catch(() => toast("error", t("expedition.couldntFind", { name: npc.name }), t("common.tryAgainSoon")))}>
                          {t("common.tryAgain")}
                        </button>
                      ) : (
                        <button type="button" className="btn btn--primary" disabled={!ready} onClick={() => void meet(npc.id)} data-testid={`meet-${npc.id}`}>
                          {ready ? (met ? t("expedition.visitAgain", { name: npc.name }) : t("expedition.meet", { name: npc.name })) : <Spinner label={t("expedition.onTheWay", { name: npc.name })} />}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card mediation-card" aria-labelledby="mediation-title">
            <p className="eyebrow">{t("mediation.challenge")}</p>
            <h3 id="mediation-title">⚖️ {t("mediation.title")}</h3>
            <p className="muted small">{t("mediation.pitch")}</p>
            {(() => {
              const m = game.active.mediation;
              const resumable = m && m.expeditionId === expedition.id && m.status !== "debriefed";
              return (
                <button type="button" className="btn" onClick={() => void startMediation()} disabled={game.ui.sceneLoading} data-testid="start-mediation">
                  {game.ui.sceneLoading ? <Spinner label={t("mediation.finding")} /> : resumable ? t("mediation.resume") : t("mediation.stepIn")}
                </button>
              );
            })()}
          </section>

          <p className="notice small">
            {expedition.aiMode === "demo" ? `${t("expedition.demoNote")} ` : ""}
            {t("expedition.fictionNote")}
          </p>
          <SourceList sources={expedition.sources} />
        </div>
      </aside>
    </div>
  );
}

/** The title, scene, greeting and curiosity board: the part of an expedition that arrives first. */
function BriefingHeader({ briefing }: { briefing: ExpeditionBriefing }) {
  const where = [briefing.locality.city, briefing.locality.region, briefing.locality.country].filter(Boolean).join(", ");
  return (
    <>
      <header className="expedition-head">
        <p className="eyebrow">{where || briefing.destination.label}</p>
        <h2>{briefing.title}</h2>
        {briefing.weather ? (
          <p className="weather" title={briefing.weather.attribution}>
            {briefing.weather.isDay === false ? "🌙" : "🌤️"} {briefing.weather.summary}
          </p>
        ) : null}
        <p className="scene">{briefing.scene}</p>
      </header>

      <div className="greeting-card">
        <div>
          <p className="eyebrow">{t("briefing.sayHello", { language: briefing.greeting.language })}</p>
          <p className="greeting-card__phrase">{briefing.greeting.phrase}</p>
          <p className="muted small">
            {briefing.greeting.pronunciation ? `“${briefing.greeting.pronunciation}” · ` : ""}
            {briefing.greeting.meaning}
          </p>
        </div>
        {canSpeak() ? (
          <button type="button" className="icon-btn" aria-label={t("briefing.hearIt")} onClick={() => speak(briefing.greeting.phrase)}>
            🔊
          </button>
        ) : null}
        <PronounceButton phrase={briefing.greeting.phrase} language={briefing.greeting.language} meaning={briefing.greeting.meaning} />
      </div>

      {briefing.curiosity.length ? (
        <section className="curiosity">
          <p className="eyebrow">{t("briefing.curiosity")}</p>
          <ul>
            {briefing.curiosity.map((q) => (
              <li key={q}>
                <span aria-hidden="true">?</span> {q}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/** What the model is doing right now, in the player's terms. */
function progressNote(progress: StreamProgress | null): string {
  if (!progress || progress.phase === "grounding") return t("progress.grounding");
  if (progress.phase === "thinking") return progress.thinking ? t("progress.thinkingNotes", { count: formatCount(progress.thinking) }) : t("progress.thinking");
  return t("progress.writing", { count: formatCount(progress.written) });
}

/** Two-stage arrival: the briefing is here, the locals are still being written. */
export function ArrivingScreen() {
  const busy = useGame().ui.busy;
  const map = useMap();
  const elapsed = useElapsed(busy?.startedAt ?? null);
  const destination = busy?.briefing?.destination;
  useEffect(() => {
    if (destination) map.run((m) => m.flyTo(destination, 14));
  }, [map, destination]);
  if (!busy?.briefing) return null;
  return (
    <div className="map-screen">
      <aside className="side-panel" aria-label={t("arriving.label", { title: busy.briefing.title })} aria-busy="true">
        <div className="side-panel__scroll">
          <BriefingHeader briefing={busy.briefing} />
          <section aria-label={t("expedition.locals")}>
            <p className="eyebrow">{t("expedition.peopleToMeet")}</p>
            <ul className="locals">
              {[0, 1, 2].map((i) => (
                <li key={i} className="local-card local-card--pending" aria-hidden={i > 0}>
                  {i === 0 ? <Spinner label={t("arriving.meeting", { time: formatElapsed(elapsed) })} /> : null}
                </li>
              ))}
            </ul>
            <p className="muted small" role="status">
              {progressNote(busy.progress)}
            </p>
          </section>
        </div>
      </aside>
    </div>
  );
}

const PHASES: { id: StreamProgress["phase"]; label: MessageKey }[] = [
  { id: "grounding", label: "phase.grounding" },
  { id: "thinking", label: "phase.thinking" },
  { id: "writing", label: "phase.writing" },
];

export function ScoutingOverlay() {
  const { ui, settings } = useGame();
  const busy = ui.busy;
  const elapsed = useElapsed(busy?.startedAt ?? null);
  // While the Game Master works, fly in over Google's photorealistic 3D map (Google mode only).
  const flyRef = useRef<HTMLDivElement>(null);
  const flying =
    Boolean(busy && !busy.briefing && ui.config?.features.flyIns) && settings.flyIns !== false && !settings.reducedMotion && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const target = busy?.destination;
  useEffect(() => {
    if (!flying || !target || !flyRef.current) return;
    let live = true;
    let flyIn: FlyIn | null = null;
    void startFlyIn(flyRef.current, target).then((started) => {
      if (live) flyIn = started;
      else started?.destroy();
    });
    return () => {
      live = false;
      flyIn?.destroy();
    };
  }, [flying, target]);
  if (!busy || busy.briefing) return null;
  const now = PHASES.findIndex((p) => p.id === (busy.progress?.phase ?? "grounding"));
  return (
    <div className={`overlay${flying ? " overlay--flyin" : ""}`} role="dialog" aria-modal="true" aria-label={t("overlay.travelling", { place: busy.label })}>
      {flying ? <div className="flyin" ref={flyRef} data-testid="flyin" /> : null}
      <div className="overlay__card">
        <p className="eyebrow">{t("overlay.eyebrow", { time: formatElapsed(elapsed) })}</p>
        <h2>{t("overlay.travelling", { place: busy.label })}</h2>
        <ol className="scout-steps">
          {PHASES.map((phase, i) => (
            <li key={phase.id} className={i < now ? "is-done" : i === now ? "is-now" : ""}>
              {i < now ? "✓" : i === now ? <Spinner /> : "·"} {t(phase.label)}
            </li>
          ))}
        </ol>
        <p className="muted small" role="status">
          {progressNote(busy.progress)}
        </p>
      </div>
    </div>
  );
}
