// A fake fetch serving canned Wikipedia / Open-Meteo / Nominatim responses,
// so grounding and API tests run without the network.
export interface FakeFetch {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
  urls: string[];
}

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });

export function fakeOpenDataFetch(): FakeFetch {
  const urls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    urls.push(url.toString());
    const p = url.searchParams;
    if (url.hostname.endsWith("wikipedia.org")) {
      if (p.get("generator") === "geosearch") {
        return json({
          query: {
            pages: [
              { title: "Moi Avenue (Nairobi)", extract: "Moi Avenue (Swahili: Barabara ya Moi) is one of the oldest roads in Nairobi. It is intersected by Kenyatta Avenue.", fullurl: "https://en.wikipedia.org/wiki/Moi_Avenue_(Nairobi)", coordinates: [{ lat: -1.283, lon: 36.824 }] },
              { title: "Jamia Mosque (Kenya)", extract: "The Jamia Mosque is a Sunni mosque in Nairobi, built between 1925 and 1933 through community fundraising.", fullurl: "https://en.wikipedia.org/wiki/Jamia_Mosque_(Kenya)", coordinates: [{ lat: -1.2835, lon: 36.8228 }] },
              { title: "List of roads in Nairobi", extract: "This list covers the roads of Nairobi in considerable detail for reference purposes.", coordinates: [{ lat: -1.28, lon: 36.82 }] },
              { title: "Tiny", extract: "Too short." },
            ],
          },
        });
      }
      if (p.get("generator") === "search") {
        return json({ query: { pages: [{ index: 1, title: "Lisbon", extract: "Lisbon is the capital and largest city of Portugal, on the Atlantic coast at the mouth of the Tagus.", fullurl: "https://en.wikipedia.org/wiki/Lisbon" }] } });
      }
      if (p.get("titles")) {
        return json({ query: { pages: [{ title: p.get("titles"), extract: `${p.get("titles")} (pronounced nye-ROH-bee) is the capital and largest city of Kenya. It is a hub for business and culture in East Africa.`, fullurl: `https://en.wikipedia.org/wiki/${p.get("titles")}` }] } });
      }
    }
    if (url.hostname === "api.open-meteo.com") {
      return json({ timezone: "Africa/Nairobi", current: { time: "2026-10-29T14:05", temperature_2m: 26.6, weather_code: 61, is_day: 1, wind_speed_10m: 9 } });
    }
    if (url.hostname === "nominatim.openstreetmap.org") {
      if (url.pathname.startsWith("/reverse")) return json({ lat: "0", lon: "0", display_name: "x", address: { city: "Nairobi", state: "Nairobi County", country: "Kenya" } });
      return json([{ lat: "38.7077", lon: "-9.1366", name: "Lisbon", display_name: "Lisbon, Portugal", address: { city: "Lisbon", country: "Portugal" } }]);
    }
    return new Response("not found", { status: 404 });
  }) as FakeFetch;
  fn.urls = urls;
  return fn;
}
