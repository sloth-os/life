# Common Ground

> *Explore the real world. Meet its people. Find common ground.*

**Common Ground** is a web game built around AI. You travel anywhere on Earth through **Google Maps**, meet **AI locals grounded in real places**, and earn their trust with real social skills. Each conversation ends with a **mentor debrief** that quotes your own words: what worked, one thing to try, and a rewrite of a line you actually said. As locals come to trust you, they share **insights about the place's nature, culture, history, society and economy**, each linked to its source. Those insights become cards in your field journal, which you review with spaced repetition.

| World map | A conversation | Mentor debrief |
|---|---|---|
| ![World map](docs/images/world.jpg) | ![Encounter](docs/images/encounter.jpg) | ![Debrief](docs/images/debrief.jpg) |

*(Screenshots are from Demo AI + Open map mode. With API keys you get Claude-played locals, Google Maps and Street View.)*

## Why it works

The design is based on research about how people learn conversation skills. In brief (details and citations in [`docs/DESIGN.md`](docs/DESIGN.md)):

- **AI Partner + AI Mentor**: separate agents play the local and coach you (Yang et al., 2024).
- **Feedback is what builds skill.** In a randomized trial, practice alone mostly raised confidence; skill gains needed feedback (CARE, Louie et al., 2025). So every encounter ends in a debrief with **verbatim evidence**, which the server checks.
- **Realistic, principled partners.** Locals follow a written constitution (Roleplay-doh; Rehearsal): their rapport is earned, they disclose more only as trust grows, they have boundaries and their own agenda, and they don't flatter you (social sycophancy research).
- **People, not stereotypes.** Prompts follow a persona charter to counter the exoticizing patterns that LLM-written personas fall into (Marked Personas, ACL 2023).
- **Experiential learning loop.** You reflect first, then get feedback, then a concept card, then a **real-world field mission** (Kolb; deliberate practice). Insights become **spaced-recall** cards.

The **Skill Compass** tracks six skills: 🧭 Curiosity · 👂 Listening · 💛 Empathy · 🙏 Respect · 🔆 Clarity · 🤝 Common Ground.

## Quick start

Requires **Node.js 22.18+**; the server runs TypeScript natively.

```bash
npm install
npm run dev          # http://localhost:8787
```

It runs with **no keys at all**, in Demo AI + Open map mode: scripted locals built from real Wikipedia and Open-Meteo data, drawn on an OpenStreetMap-based map. Add keys to unlock the full experience:

```bash
cp .env.example .env   # then fill in what you have
```

| Variable | What it enables |
|---|---|
| `ANTHROPIC_API_KEY` | **Claude** plays the Game Master, the locals and the mentor (default model `claude-opus-5-5`; override with `CLAUDE_MODEL`) |
| `GOOGLE_MAPS_API_KEY` | **Google Maps** in the browser: the interactive map, Advanced Markers and **Street View** at each local's spot. Enable the *Maps JavaScript API* and restrict the key by HTTP referrer. |
| `GOOGLE_MAPS_MAP_ID` | Your Map ID (defaults to `DEMO_MAP_ID` for testing) |
| `GOOGLE_MAPS_SERVER_KEY` | **Maps Experience agent tools** (MCP, `mapstools.googleapis.com`): grounds the AI in real Google Maps places and live weather, and powers "Go anywhere" search. Enable that API and restrict the key by API, not referrer. |
| `ACCESS_CODE` | Optional passcode for classroom or public deployments |
| `RATE_LIMIT_PER_10MIN`, `TRUST_PROXY` | AI requests per player per 10 minutes (default 120; a shared classroom IP gets 10×). Set `TRUST_PROXY=true` behind a proxy. |
| `APP_USER_AGENT` | Contact string sent to Wikipedia, Nominatim and Open-Meteo, as their usage policies ask. Please set it. |
| `EFFORT_TURN`, `EFFORT_DEBRIEF`, … | Claude effort per task (defaults: `low` for turns and hints, `medium` for the rest) |

Production: `npm run build && npm start`.

### Modes

| | **Demo AI** (no key) | **Claude** |
|---|---|---|
| **Open map** (no Google key) | Scripted locals; MapLibre + OpenFreeMap; Wikipedia photos of places | Claude locals on the open map |
| **Google Maps** | Scripted locals on Google Maps + Street View | The full experience |

Google content and the open map are **never mixed on one screen** (Google Maps Platform terms §3.2.3(e)).

## How it works

```
Browser (React + Maps JS)                Server (Node + Express)                    Services
─────────────────────────                ───────────────────────                    ────────
World map ──► POST /api/expedition ──►   Grounding: Maps agent tools (MCP)  ───►   Google Maps Platform
                                                    Wikipedia, weather        ───►   Wikipedia / Open-Meteo
                                         Game Master (Claude) → expedition
Expedition ─► POST /api/npc/persona ─►   Game Master → persona + insights
Encounter ──► POST /api/npc/turn ────►   Partner (Claude, streamed over SSE)
              (server-sent events)       Engine: clamp rapport, gate insights,
                                                 enforce turn budget
Debrief ────► POST /api/coach/debrief ►  Mentor (Claude) → rubric scores;
                                         engine keeps only verbatim quotes
```

- **The model proposes; the engine decides.** Every AI output goes through structured outputs (JSON schema) and Zod validation. Rapport changes are clamped, insights unlock only above their threshold (one per turn), and the mentor's quotes are checked against the transcript.
- **Streaming**: the NPC's `reply` field is pulled out of the partial JSON stream and sent to the browser as it is written.
- **Prompt caching**: constitution, then persona, then an append-only transcript, with per-turn state kept in the newest message. Unit tests check that the cached prefix stays stable.
- **Refusal handling**: `fallbacks: "default"` (server-side fallback beta), and `stop_reason: "refusal"` is handled explicitly.
- **Stateless server**: the browser holds the save (`localStorage`), and each request carries what it needs.

Prompts live in [`server/ai/prompts.ts`](server/ai/prompts.ts). The game rules are in [`shared/rules.ts`](shared/rules.ts) and [`server/game/engine.ts`](server/game/engine.ts).

### Google Maps Platform terms

LLM output may draw on Google Maps data only through **Maps Experience agent tools**, and must show the Google Maps source links (Service Specific Terms §10.2.1). The rest of the design follows from that:

- Grounded places and summaries come only from the agent tools and always appear with their Google Maps links.
- Raw tool results stay in server memory for the session (≤ 2 h). Coordinates of Google places in saved games are dropped after 30 days.
- Coordinates from a Google search result are never sent to third parties; Wikipedia is queried with the player's own words instead.
- Voice output keeps the full transcript on screen and shows a notice.

This is engineering diligence, not legal advice. Review the terms for your own deployment.

**Usage per expedition** (approximate): 1 expedition call + 3 persona calls (prefetched) + one call per player message + optional hints + 1 debrief ≈ 15–20 Claude calls. Google side: 5 `search_places` + 1 `lookup_weather` per expedition, 1 map load per session, and 1 Street View load per encounter.

## Development

```bash
npm run typecheck    # TypeScript (server + client + tests)
npm test             # unit + integration (Vitest)
npm run test:e2e     # browser tests (Playwright; desktop + phone)
```

The tests run without network or keys:
- **Claude**: the real Anthropic SDK with a fake `fetch` serving streamed responses. Checks the request shape (model, effort, structured output schema, caching, fallback beta) and the handling of refusals, truncation, schema violations and rate limits.
- **Maps agent tools**: our MCP client against a local MCP server with the same tool names and argument shapes.
- **API**: the full HTTP flow through the real engine with Demo AI, including SSE streaming, access codes and rate limiting.
- **E2E**: onboarding → travel → conversation (including a stereotyping line flagged as `⚠ assumption`) → coach → reflection → debrief → journal review, on desktop and a Pixel 7 viewport.

```
shared/        game vocabulary + rules + API schemas (used by both sides)
server/
  ai/          Claude engine, Demo engine, prompts, output schemas, streaming JSON
  game/        engine: orchestration + authoritative rules
  grounding/   Maps agent tools (MCP), Wikipedia, Open-Meteo, Nominatim
src/           React client: screens, map adapters (Google / MapLibre), state
tests/         unit + integration (Vitest), e2e (Playwright)
docs/          DESIGN.md: research, learning design, AI design, compliance
```

## Status and known limits

- The Claude path is verified against the SDK's request and streaming contract with simulated responses. Prompt quality still needs a **live evaluation pass** with a real key (plan in `docs/DESIGN.md` §7.4).
- Google documents the inputs of the Maps Experience agent tools but not all output fields. The parser accepts several shapes and logs the result keys on first use; check the logs once with your key.
- Demo AI is deliberately simple and labelled as such. It's for trying the game, for classrooms without API budgets, and for tests.

## Safety and privacy

Locals are fictional and played by AI, with content suitable for ages 13 and up. Disrespect has realistic consequences: the local walks away, and the mentor addresses it without shaming. Progress stays in the browser and the server keeps no player data. The game is framed as rehearsal for real conversations, and field missions push practice into the real world.
