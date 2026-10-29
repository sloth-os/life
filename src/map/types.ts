import type { LatLng } from "../../shared/schemas.ts";

export interface MapMarker {
  id: string;
  position: LatLng;
  kind: "postcard" | "visited" | "npc" | "pin";
  label: string;
  /** Short text inside the marker: an emoji or initials. */
  glyph: string;
  color: string;
  selected?: boolean;
  dimmed?: boolean;
}

export interface MapInsets {
  left: number;
  bottom: number;
}

/** What the screens need from a map, whichever provider draws it. */
export interface WorldMap {
  readonly provider: "google" | "open";
  setMarkers(markers: MapMarker[]): void;
  flyTo(position: LatLng, zoom: number): void;
  fitTo(points: LatLng[], maxZoom?: number): void;
  setHandlers(handlers: { onMarker?: (id: string) => void; onMap?: (position: LatLng) => void }): void;
  /** Screen space covered by UI (the side panel), so camera moves centre on the visible part. */
  setInsets(insets: MapInsets): void;
  setDark(dark: boolean): void;
  destroy(): void;
}

/** An on-the-ground view of a place (Street View in Google mode). */
export interface SceneView {
  /** Resolves to true when imagery is available at (or near) the position. */
  show(position: LatLng, lookAt?: LatLng): Promise<boolean>;
  destroy(): void;
}

export function markerElement(marker: MapMarker, onClick?: () => void): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `map-marker map-marker--${marker.kind}${marker.selected ? " is-selected" : ""}${marker.dimmed ? " is-dimmed" : ""}`;
  el.style.setProperty("--marker-color", marker.color);
  el.setAttribute("aria-label", marker.label);
  el.title = marker.label;
  const glyph = document.createElement("span");
  glyph.className = "map-marker__glyph";
  const text = document.createElement("span");
  text.textContent = marker.glyph;
  glyph.append(text);
  el.append(glyph);
  if (marker.kind !== "pin") {
    const label = document.createElement("span");
    label.className = "map-marker__label";
    label.textContent = marker.label;
    el.append(label);
  }
  if (onClick) {
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
  }
  return el;
}
