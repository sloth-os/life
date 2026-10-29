import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { POSTCARDS, type Postcard } from "../../shared/destinations.ts";
import { rankFor } from "../../shared/rules.ts";
import type { Destination, GeoResult } from "../../shared/schemas.ts";
import { SKILLS } from "../../shared/skills.ts";
import { LENSES, SCENARIOS } from "../../shared/world.ts";
import { Avatar, Difficulty, LensTag, SourceList, Spinner } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { canSpeak, speak } from "../lib/speech.ts";
import { useMap } from "../map/index.ts";
import type { MapMarker } from "../map/types.ts";
import { SCOUT_STEPS, currentExpedition, ensurePersona, go, meet, personKey, startExpedition, surpriseDestination, toast } from "../state/actions.ts";
import { useGame } from "../state/store.ts";

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
      label: p.name,
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
  }, [visited, game.atlas, selected]);

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
      toast("error", "Search failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  };

  const postcard = selected?.postcardId ? POSTCARDS.find((p) => p.id === selected.postcardId) : undefined;

  return (
    <div className="map-screen">
      <aside className="side-panel" aria-label="Choose a destination">
        <div className="side-panel__scroll">
          <header className="hello">
            <h2>Where to next, {game.player!.name}?</h2>
            <p className="muted">
              {rank.name} · focus: {focus.icon} {focus.name}{" "}
              <button type="button" className="link-btn" onClick={() => go("compass")}>
                change
              </button>
            </p>
          </header>

          {selected ? (
            <div className="travel-card" data-testid="travel-card">
              <p className="eyebrow">{selected.source === "pin" ? "Dropped pin" : postcard ? `${postcard.continent} · postcard` : "Destination"}</p>
              <h3>{selected.label}</h3>
              {postcard ? <p>{postcard.theme}</p> : selected.source === "pin" ? <p>Your guide will figure out where you've landed.</p> : <p>{selected.country}</p>}
              {postcard ? (
                <p className="tags">
                  {postcard.lenses.map((l) => (
                    <LensTag key={l} lens={l} />
                  ))}
                </p>
              ) : null}
              <div className="row">
                <button type="button" className="btn btn--primary" onClick={() => void startExpedition(selected)} disabled={Boolean(game.ui.busy)}>
                  Travel here
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setSelected(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="suggestion">
              <p className="eyebrow">Today's postcard</p>
              <button type="button" className="suggestion__card" onClick={() => choose(postcardDestination(suggestion))}>
                <strong>
                  {suggestion.name}, {suggestion.country}
                </strong>
                <span>{suggestion.theme}</span>
              </button>
              <div className="row">
                <button type="button" className="btn" onClick={() => choose(surpriseDestination(game))}>
                  🎲 Surprise me
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
              Go anywhere
            </label>
            {searchEnabled ? (
              <div className="search__row">
                <input id="go-anywhere" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A city, a market, a mountain town…" />
                <button type="submit" className="btn" disabled={searching || query.trim().length < 2}>
                  {searching ? <Spinner /> : "Search"}
                </button>
              </div>
            ) : (
              <p className="muted small">Search needs Maps agent tools (GOOGLE_MAPS_SERVER_KEY).</p>
            )}
            <p className="muted small">…or click anywhere on the map to drop a pin.</p>
            {results ? (
              <ul className="results">
                {results.length === 0 ? <li className="muted">No places found.</li> : null}
                {results.map((r, i) => (
                  <li key={`${r.lat},${r.lng},${i}`}>
                    <button type="button" onClick={() => choose({ lat: r.lat, lng: r.lng, label: r.label, country: r.sublabel?.split(", ").at(-1), source: "search", mapsUrl: r.mapsUrl, query: query.trim() })}>
                      <strong>{r.label}</strong>
                      {r.sublabel ? <span className="muted"> · {r.sublabel}</span> : null}
                    </button>
                  </li>
                ))}
                {results.length ? <li className="muted small">Results: {results[0]!.attribution}</li> : null}
              </ul>
            ) : null}
          </form>

          <section className="postcards" aria-label="Postcards">
            <p className="eyebrow">Postcards from six continents</p>
            {CONTINENTS.map((continent) => (
              <details key={continent} open={continent === "Africa" || continent === "Asia"}>
                <summary>{continent}</summary>
                <ul>
                  {POSTCARDS.filter((p) => p.continent === continent).map((p) => (
                    <li key={p.id}>
                      <button type="button" className={`postcard-row${selected?.postcardId === p.id ? " is-on" : ""}`} onClick={() => choose(postcardDestination(p))}>
                        <span className="postcard-row__name">
                          {visited.has(p.id) ? "✓ " : ""}
                          {p.name}
                          <span className="muted"> · {p.country}</span>
                        </span>
                        <span className="postcard-row__theme">{p.theme}</span>
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
            <p>No active expedition.</p>
            <button type="button" className="btn btn--primary" onClick={() => go("world")}>
              Back to the world map
            </button>
          </div>
        </aside>
      </div>
    );
  }

  const where = [expedition.locality.city, expedition.locality.region, expedition.locality.country].filter(Boolean).join(", ");
  const unfinished = game.active.encounter && game.active.encounter.expeditionId === expedition.id && game.active.encounter.status !== "debriefed" ? game.active.encounter : null;

  return (
    <div className="map-screen">
      <aside className="side-panel" aria-label={`Expedition: ${expedition.title}`}>
        <div className="side-panel__scroll">
          <button type="button" className="link-btn back" onClick={() => go("world")}>
            ← World map
          </button>
          {unfinished ? (
            <div className="resume" role="status">
              <span>
                {unfinished.status === "active" ? `You were talking with ${unfinished.persona.name}.` : `Your conversation with ${unfinished.persona.name} is waiting for your reflection.`}
              </span>
              <button type="button" className="btn btn--primary btn--small" onClick={() => go("encounter")}>
                Continue
              </button>
            </div>
          ) : null}
          <header className="expedition-head">
            <p className="eyebrow">{where || expedition.destination.label}</p>
            <h2>{expedition.title}</h2>
            {expedition.weather ? (
              <p className="weather" title={expedition.weather.attribution}>
                {expedition.weather.isDay === false ? "🌙" : "🌤️"} {expedition.weather.summary}
              </p>
            ) : null}
            <p className="scene">{expedition.scene}</p>
          </header>

          <div className="greeting-card">
            <div>
              <p className="eyebrow">Say hello in {expedition.greeting.language}</p>
              <p className="greeting-card__phrase">{expedition.greeting.phrase}</p>
              <p className="muted small">
                {expedition.greeting.pronunciation ? `“${expedition.greeting.pronunciation}” · ` : ""}
                {expedition.greeting.meaning}
              </p>
            </div>
            {canSpeak() ? (
              <button type="button" className="icon-btn" aria-label="Hear it" onClick={() => speak(expedition.greeting.phrase)}>
                🔊
              </button>
            ) : null}
          </div>

          {expedition.curiosity.length ? (
            <section className="curiosity">
              <p className="eyebrow">Curiosity board</p>
              <ul>
                {expedition.curiosity.map((q) => (
                  <li key={q}>
                    <span aria-hidden="true">?</span> {q}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-label="Locals">
            <p className="eyebrow">People you can meet</p>
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
                            <a href={npc.mapsUrl} target="_blank" rel="noreferrer" title="Open in Google Maps">
                              {npc.placeName}
                            </a>
                          ) : (
                            npc.placeName
                          )}
                        </p>
                      </div>
                    </div>
                    <p className="local-card__hook">“{npc.hook}”</p>
                    <p className="tags">
                      <LensTag lens={npc.lens} />
                      <span className="tag">
                        {scenario.icon} {scenario.name}
                      </span>
                      <Difficulty level={npc.difficulty} />
                    </p>
                    <p className="local-card__goal">
                      <strong>Goal:</strong> {npc.goal}
                    </p>
                    <div className="row">
                      {met ? <span className="muted small">Met · rapport {Math.round(met.lastRapport)}</span> : null}
                      {status === "error" && !ready ? (
                        <button type="button" className="btn" onClick={() => void ensurePersona(expedition, npc).catch(() => toast("error", `Couldn't find ${npc.name}`, "Try again in a moment."))}>
                          Try again
                        </button>
                      ) : (
                        <button type="button" className="btn btn--primary" disabled={!ready} onClick={() => void meet(npc.id)} data-testid={`meet-${npc.id}`}>
                          {ready ? (met ? `Visit ${npc.name} again` : `Meet ${npc.name}`) : <Spinner label={`${npc.name} is on the way…`} />}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <p className="notice small">
            {expedition.aiMode === "demo" ? "Demo AI: scripted locals built from real sources. " : ""}People here are fictional characters played by AI; facts come from the sources
            below — check them, and ask locals in real life too.
          </p>
          <SourceList sources={expedition.sources} />
        </div>
      </aside>
    </div>
  );
}

export function ScoutingOverlay() {
  const busy = useGame().ui.busy;
  if (!busy) return null;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={`Travelling to ${busy.label}`}>
      <div className="overlay__card">
        <p className="eyebrow">Expedition</p>
        <h2>Travelling to {busy.label}</h2>
        <ol className="scout-steps">
          {SCOUT_STEPS.map((step, i) => (
            <li key={step} className={i < busy.step ? "is-done" : i === busy.step ? "is-now" : ""}>
              {i < busy.step ? "✓" : i === busy.step ? <Spinner /> : "·"} {step}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
