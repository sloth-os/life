import { createContext, useContext } from "react";
import type { AppConfig } from "../../shared/schemas.ts";
import type { SceneView, WorldMap } from "./types.ts";

/**
 * Screens drive the single, long-lived map through this controller. Calls made
 * before the map has loaded are queued and replayed once it is ready.
 */
export class MapController {
  #map: WorldMap | null = null;
  #queue: ((map: WorldMap) => void)[] = [];

  attach(map: WorldMap): void {
    this.#map = map;
    const queued = this.#queue;
    this.#queue = [];
    for (const fn of queued) fn(map);
  }

  detach(): void {
    this.#map = null;
  }

  get provider(): WorldMap["provider"] | null {
    return this.#map?.provider ?? null;
  }

  run(fn: (map: WorldMap) => void): void {
    if (this.#map) fn(this.#map);
    else this.#queue.push(fn);
  }
}

export const MapContext = createContext<MapController>(new MapController());
export const useMap = (): MapController => useContext(MapContext);

export async function createWorldMap(container: HTMLElement, config: AppConfig, dark: boolean): Promise<WorldMap> {
  if (config.mapsMode === "google" && config.googleMapsApiKey) {
    const { createGoogleMap } = await import("./google.ts");
    return createGoogleMap(container, { apiKey: config.googleMapsApiKey, mapId: config.googleMapId ?? "DEMO_MAP_ID", dark });
  }
  const { createOpenMap } = await import("./open.ts");
  return createOpenMap(container, { dark });
}

/** Street View in Google mode; Open mode has no street-level imagery (the UI shows a place card). */
export async function createSceneView(container: HTMLElement, config: AppConfig): Promise<SceneView | null> {
  if (config.mapsMode !== "google" || !config.googleMapsApiKey) return null;
  const { createGoogleScene } = await import("./google.ts");
  return createGoogleScene(container, config.googleMapsApiKey);
}
