// Google Maps implementation: Maps JavaScript API (vector map + Advanced
// Markers) and Street View. One map instance lives for the whole session —
// Dynamic Maps are billed per map load.
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import type { LatLng } from "../../shared/schemas.ts";
import { markerElement, type MapMarker, type SceneView, type WorldMap } from "./types.ts";

let configured = false;

function configure(apiKey: string): void {
  if (configured) return;
  setOptions({ key: apiKey, v: "weekly" });
  configured = true;
}

export async function createGoogleMap(container: HTMLElement, opts: { apiKey: string; mapId: string; dark: boolean }): Promise<WorldMap> {
  configure(opts.apiKey);
  const [{ Map }, { AdvancedMarkerElement }, core] = await Promise.all([importLibrary("maps"), importLibrary("marker"), importLibrary("core")]);
  const { ColorScheme } = core;

  const create = (dark: boolean) =>
    new Map(container, {
      center: { lat: 20, lng: 10 },
      zoom: 2,
      minZoom: 2,
      mapId: opts.mapId,
      colorScheme: dark ? ColorScheme.DARK : ColorScheme.LIGHT,
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: "greedy",
      clickableIcons: false,
      isFractionalZoomEnabled: true,
    });
  let map = create(opts.dark);
  let dark = opts.dark;
  let markers: google.maps.marker.AdvancedMarkerElement[] = [];
  let lastMarkers: MapMarker[] = [];
  let handlers: { onMarker?: (id: string) => void; onMap?: (position: LatLng) => void } = {};
  let insets = { left: 0, bottom: 0 };
  let clickListener: google.maps.MapsEventListener | null = null;

  const bindClick = () => {
    clickListener?.remove();
    clickListener = map.addListener("click", (event: google.maps.MapMouseEvent) => {
      if (event.latLng) handlers.onMap?.({ lat: event.latLng.lat(), lng: event.latLng.lng() });
    });
  };
  bindClick();

  const draw = (list: MapMarker[]) => {
    for (const m of markers) m.map = null;
    markers = list.map(
      (marker) =>
        new AdvancedMarkerElement({
          map,
          position: marker.position,
          title: marker.label,
          zIndex: marker.selected ? 1000 : marker.kind === "npc" ? 500 : 100,
          content: markerElement(marker, () => handlers.onMarker?.(marker.id)),
        }),
    );
  };

  const world: WorldMap = {
    provider: "google",
    setMarkers(list) {
      lastMarkers = list;
      draw(list);
    },
    flyTo(position, zoom) {
      map.setZoom(zoom);
      map.panTo(position);
      // Shift so the point sits in the middle of the area the side panel leaves visible.
      if (insets.left || insets.bottom) map.panBy(-insets.left / 2, insets.bottom / 2);
    },
    fitTo(points, maxZoom = 16) {
      if (points.length === 0) return;
      if (points.length === 1) {
        world.flyTo(points[0]!, Math.min(maxZoom, 15));
        return;
      }
      const bounds = new core.LatLngBounds();
      for (const p of points) bounds.extend(p);
      map.fitBounds(bounds, { top: 70, right: 70, left: insets.left + 70, bottom: insets.bottom + 70 });
      core.event.addListenerOnce(map, "idle", () => {
        if ((map.getZoom() ?? 0) > maxZoom) map.setZoom(maxZoom);
      });
    },
    setHandlers(next) {
      handlers = next;
    },
    setInsets(next) {
      insets = next;
    },
    setDark(next) {
      // colorScheme is fixed at construction; recreate only when it actually changes.
      if (next === dark) return;
      dark = next;
      const center = map.getCenter();
      const zoom = map.getZoom();
      map = create(dark);
      if (center) map.setCenter(center);
      if (zoom !== undefined) map.setZoom(zoom);
      bindClick();
      draw(lastMarkers);
    },
    destroy() {
      for (const m of markers) m.map = null;
      clickListener?.remove();
      container.replaceChildren();
    },
  };
  return world;
}

export async function createGoogleScene(container: HTMLElement, apiKey: string): Promise<SceneView> {
  configure(apiKey);
  const [{ StreetViewService, StreetViewPanorama, StreetViewPreference, StreetViewSource }, { spherical }] = await Promise.all([
    importLibrary("streetView"),
    importLibrary("geometry"),
  ]);
  const service = new StreetViewService();
  let panorama: google.maps.StreetViewPanorama | null = null;

  return {
    async show(position, lookAt) {
      try {
        const { data } = await service.getPanorama({
          location: position,
          radius: 300,
          preference: StreetViewPreference.NEAREST,
          sources: [StreetViewSource.OUTDOOR],
        });
        const panoLatLng = data.location?.latLng;
        if (!data.location?.pano || !panoLatLng) return false;
        const heading = lookAt ? spherical.computeHeading(panoLatLng, lookAt) : 0;
        const pov = { heading: Number.isFinite(heading) ? heading : 0, pitch: 0 };
        if (!panorama) {
          panorama = new StreetViewPanorama(container, {
            pano: data.location.pano,
            pov,
            addressControl: false,
            fullscreenControl: false,
            motionTracking: false,
            motionTrackingControl: false,
            showRoadLabels: false,
            enableCloseButton: false,
            zoomControl: false,
            panControl: false,
          });
        } else {
          panorama.setPano(data.location.pano);
          panorama.setPov(pov);
        }
        return true;
      } catch {
        return false;
      }
    },
    destroy() {
      panorama?.setVisible(false);
      panorama = null;
      container.replaceChildren();
    },
  };
}
