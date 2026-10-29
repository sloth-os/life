// Runs our MCP client against a local stand-in for Google's Maps Experience
// agent tools server (same transport, tool names and argument shapes).
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { MapsAgentTools, buildLocationBias, parsePlaceSearch, parseRoute, parseWeather, payloadOf } from "../../server/grounding/mapsAgentTools.ts";

describe("payload parsing", () => {
  it("prefers structuredContent, then JSON text, then plain text", () => {
    expect(payloadOf({ structuredContent: { a: 1 }, content: [{ type: "text", text: '{"b":2}' }] })).toEqual({ a: 1 });
    expect(payloadOf({ content: [{ type: "text", text: '{"b":2}' }] })).toEqual({ b: 2 });
    expect(payloadOf({ content: [{ type: "text", text: "Two cafés nearby." }] })).toEqual({ summary: "Two cafés nearby." });
  });

  it("reads places in camelCase or snake_case", () => {
    const camel = parsePlaceSearch({
      summary: "Markets near the centre [0].",
      places: [{ name: "places/ChIJ1", displayName: { text: "City Market" }, location: { latitude: -1.28, longitude: 36.82 }, googleMapsLinks: { placeUrl: "https://maps.google.com/?cid=1" } }],
    });
    expect(camel).toEqual({
      summary: "Markets near the centre [0].",
      places: [{ name: "City Market", address: undefined, location: { lat: -1.28, lng: 36.82 }, mapsUrl: "https://maps.google.com/?cid=1", placeId: "ChIJ1" }],
    });
    const snake = parsePlaceSearch({ result: { answer: "One park.", results: [{ place_id: "X9", display_name: "Uhuru Park", lat_lng: { lat: 1, lng: 2 } }] } });
    expect(snake.summary).toBe("One park.");
    expect(snake.places[0]).toMatchObject({ name: "Uhuru Park", placeId: "X9", location: { lat: 1, lng: 2 }, mapsUrl: "https://www.google.com/maps/place/?q=place_id:X9" });
  });

  it("summarizes weather from nested fields", () => {
    const weather = parseWeather({ currentConditions: { temperature: { degrees: 26.6, unit: "CELSIUS" }, weatherCondition: { description: { text: "Light rain" } }, isDaytime: true } });
    expect(weather).toMatchObject({ summary: "27°C, Light rain", tempC: 27, condition: "Light rain", isDay: true });
  });
});

describe("parseRoute", () => {
  it("reads duration and distance in either convention, filling in what's missing", () => {
    expect(parseRoute({ routes: [{ duration: "600s", distanceMeters: 800 }] })).toEqual({ minutes: 10, meters: 800 });
    expect(parseRoute({ routes: [{ static_duration: { seconds: 120 }, distance_meters: 150 }] })).toEqual({ minutes: 2, meters: 150 });
    expect(parseRoute({ routes: [{ distance_meters: 390 }] })).toEqual({ minutes: 5, meters: 390 });
    expect(parseRoute({ routes: [] })).toBeNull();
  });
});

describe("buildLocationBias", () => {
  const center = { lat: 10, lng: 20 };
  it("follows the declared schema shape", () => {
    const nested = { properties: { location_bias: { properties: { circle: { properties: { center: { properties: { latitude: {}, longitude: {} } }, radius_meters: {} } } } } } };
    expect(buildLocationBias(nested, center, 500)).toEqual({ key: "location_bias", value: { circle: { center: { latitude: 10, longitude: 20 }, radius_meters: 500 } } });
    const flat = { properties: { locationBias: { properties: { lat: {}, lng: {}, radiusMeters: {} } } } };
    expect(buildLocationBias(flat, center, 500)).toEqual({ key: "locationBias", value: { lat: 10, lng: 20, radiusMeters: 500 } });
  });

  it("falls back to the documented circle shape", () => {
    expect(buildLocationBias(undefined, center, 300).value).toEqual({ circle: { center: { latitude: 10, longitude: 20 }, radius_meters: 300 } });
  });
});

describe("MapsAgentTools over MCP", () => {
  const keys: (string | undefined)[] = [];
  const calls: { tool: string; args: unknown }[] = [];
  let server: ReturnType<express.Express["listen"]>;
  let url = "";

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.post("/mcp", async (req, res) => {
      keys.push(req.get("x-goog-api-key"));
      const mcp = new McpServer({ name: "fake-mapstools", version: "1.0.0" });
      mcp.registerTool(
        "search_places",
        {
          description: "Find places",
          inputSchema: {
            text_query: z.string(),
            language_code: z.string().optional(),
            location_bias: z.object({ circle: z.object({ center: z.object({ latitude: z.number(), longitude: z.number() }), radius_meters: z.number().optional() }) }).optional(),
          },
        },
        async (args) => {
          calls.push({ tool: "search_places", args });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  summary: `Results for ${args.text_query}`,
                  places: [{ name: "places/ChIJabc", id: "ChIJabc", displayName: { text: "City Market" }, location: { latitude: -1.2833, longitude: 36.8271 }, googleMapsLinks: { placeUrl: "https://maps.google.com/?cid=42" } }],
                }),
              },
            ],
          };
        },
      );
      mcp.registerTool("lookup_weather", { description: "Weather", inputSchema: { location: z.object({ lat_lng: z.object({ latitude: z.number(), longitude: z.number() }) }), units_system: z.string().optional() } }, async (args) => {
        calls.push({ tool: "lookup_weather", args });
        return { content: [{ type: "text" as const, text: JSON.stringify({ currentConditions: { temperature: { degrees: 24.2 }, weatherCondition: { description: { text: "Partly cloudy" } }, isDaytime: true } }) }] };
      });
      mcp.registerTool(
        "compute_routes",
        {
          description: "Routes",
          inputSchema: { origin: z.object({ lat_lng: z.object({ latitude: z.number(), longitude: z.number() }) }), destination: z.object({ lat_lng: z.object({ latitude: z.number(), longitude: z.number() }) }), travel_mode: z.string().optional() },
        },
        async (args) => {
          calls.push({ tool: "compute_routes", args });
          return { content: [{ type: "text" as const, text: JSON.stringify({ routes: [{ distanceMeters: 742, duration: "561s" }] }) }] };
        },
      );
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  });

  afterAll(() => {
    server.close();
  });

  it("calls search_places with the API key header and a schema-shaped location bias", async () => {
    const tools = new MapsAgentTools({ apiKey: "maps-key", endpoint: url });
    const found = await tools.searchPlaces("markets near Nairobi", { lat: -1.28, lng: 36.82 }, 2000);
    expect(found.summary).toBe("Results for markets near Nairobi");
    expect(found.places).toEqual([{ name: "City Market", address: undefined, location: { lat: -1.2833, lng: 36.8271 }, mapsUrl: "https://maps.google.com/?cid=42", placeId: "ChIJabc" }]);
    const call = calls.find((c) => c.tool === "search_places")!;
    expect(call.args).toMatchObject({ text_query: "markets near Nairobi", location_bias: { circle: { center: { latitude: -1.28, longitude: 36.82 }, radius_meters: 2000 } } });
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k === "maps-key")).toBe(true);

    const weather = await tools.lookupWeather({ lat: -1.28, lng: 36.82 });
    expect(weather).toMatchObject({ summary: "24°C, Partly cloudy", isDay: true });

    expect(await tools.walkingRoute({ lat: -1.28, lng: 36.82 }, { lat: -1.2833, lng: 36.8271 })).toEqual({ minutes: 9, meters: 742 });
    expect(calls.find((c) => c.tool === "compute_routes")!.args).toEqual({
      origin: { lat_lng: { latitude: -1.28, longitude: 36.82 } },
      destination: { lat_lng: { latitude: -1.2833, longitude: 36.8271 } },
      travel_mode: "WALK",
    });
    await tools.close();
  });
});
