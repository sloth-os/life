// Open map mode: MapLibre GL with OpenFreeMap vector tiles (OpenStreetMap data).
// Used only when no Google Maps key is configured — never mixed with Google content.
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre locates its worker relative to its own module, which bundling breaks;
// point it at the copy Vite emits instead.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

setWorkerUrl(workerUrl);
import type { LatLng } from "../../shared/schemas.ts";
import { markerElement, type MapMarker, type WorldMap } from "./types.ts";

const STYLES = {
  light: "https://tiles.openfreemap.org/styles/liberty",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

export async function createOpenMap(container: HTMLElement, opts: { dark: boolean }): Promise<WorldMap> {
  const map = new MapLibreMap({
    container,
    style: opts.dark ? STYLES.dark : STYLES.light,
    center: [10, 20],
    zoom: 1.4,
    minZoom: 1,
    attributionControl: { compact: true },
  });
  map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
  let dark = opts.dark;
  let markers: Marker[] = [];
  let handlers: { onMarker?: (id: string) => void; onMap?: (position: LatLng) => void } = {};

  map.on("click", (event) => handlers.onMap?.({ lat: event.lngLat.lat, lng: event.lngLat.lng }));
  await new Promise<void>((resolve) => {
    if (map.loaded()) resolve();
    else map.once("load", () => resolve());
    // Don't block the game on slow tiles.
    setTimeout(resolve, 4000);
  });

  const world: WorldMap = {
    provider: "open",
    setMarkers(list: MapMarker[]) {
      for (const m of markers) m.remove();
      markers = list.map((marker) =>
        new Marker({ element: markerElement(marker, () => handlers.onMarker?.(marker.id)), anchor: "bottom" }).setLngLat([marker.position.lng, marker.position.lat]).addTo(map),
      );
    },
    flyTo(position, zoom) {
      map.flyTo({ center: [position.lng, position.lat], zoom, essential: true, duration: 1800 });
    },
    fitTo(points, maxZoom = 16) {
      if (points.length === 0) return;
      if (points.length === 1) {
        world.flyTo(points[0]!, Math.min(maxZoom, 15));
        return;
      }
      const bounds = new LngLatBounds();
      for (const p of points) bounds.extend([p.lng, p.lat]);
      map.fitBounds(bounds, { padding: 70, maxZoom, duration: 1600 });
    },
    setHandlers(next) {
      handlers = next;
    },
    setInsets(insets) {
      map.setPadding({ top: 0, right: 0, left: insets.left, bottom: insets.bottom });
    },
    setDark(next) {
      if (next === dark) return;
      dark = next;
      map.setStyle(next ? STYLES.dark : STYLES.light);
    },
    destroy() {
      for (const m of markers) m.remove();
      map.remove();
    },
  };
  return world;
}
