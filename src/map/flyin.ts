// A photorealistic 3D fly-in over the destination while the Game Master writes the briefing
// (Google mode only): Google's Map3DElement flies down from high above, then circles the place.
// It is decoration, so anything missing (the 3D library for this key, WebGL) means no fly-in.
import { importLibrary } from "@googlemaps/js-api-loader";
import type { LatLng } from "../../shared/schemas.ts";

export interface FlyIn {
  destroy(): void;
}

export async function startFlyIn(container: HTMLElement, center: LatLng): Promise<FlyIn | null> {
  try {
    const { Map3DElement } = await importLibrary("maps3d");
    const map = new Map3DElement({
      center: { lat: center.lat, lng: center.lng, altitude: 0 },
      range: 6_000_000,
      tilt: 0,
      heading: 0,
      mode: "SATELLITE",
      defaultUIHidden: true,
    });
    map.classList.add("flyin__map");
    map.setAttribute("aria-hidden", "true");
    container.append(map);
    const close = { center: { lat: center.lat, lng: center.lng, altitude: 0 }, range: 1600, tilt: 62, heading: 30 };
    map.flyCameraTo({ endCamera: close, durationMillis: 9_000 });
    map.addEventListener("gmp-animationend", () => map.flyCameraAround({ camera: close, durationMillis: 45_000, repeatCount: 4 }), { once: true });
    container.dataset.flyin = "flying";
    return {
      destroy: () => {
        map.stopCameraAnimation();
        map.remove();
        delete container.dataset.flyin;
      },
    };
  } catch (error) {
    console.info("3D fly-in unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
}
