// Curated starting destinations ("postcards") across six continents.
// Coordinates are public-domain city/landmark centres chosen for good
// Street View coverage; the Game Master grounds everything else live.
import type { LensId } from "./world.ts";

export interface Postcard {
  id: string;
  name: string;
  country: string;
  continent: "Africa" | "Asia" | "Europe" | "North America" | "South America" | "Oceania";
  lat: number;
  lng: number;
  theme: string;
  lenses: LensId[];
}

export const POSTCARDS: Postcard[] = [
  { id: "nairobi", name: "Nairobi", country: "Kenya", continent: "Africa", lat: -1.2841, lng: 36.8235, theme: "Matatu culture, markets and the Silicon Savannah", lenses: ["economy", "culture"] },
  { id: "accra", name: "Accra", country: "Ghana", continent: "Africa", lat: 5.5487, lng: -0.2109, theme: "Makola Market, kente and a fast-growing coast", lenses: ["economy", "history"] },
  { id: "marrakech", name: "Marrakech", country: "Morocco", continent: "Africa", lat: 31.6258, lng: -7.9891, theme: "Medina souks and the craft economy", lenses: ["economy", "culture"] },
  { id: "kyoto", name: "Kyoto", country: "Japan", continent: "Asia", lat: 35.005, lng: 135.7649, theme: "Nishiki Market: tradition meets tourism pressure", lenses: ["culture", "society"] },
  { id: "varanasi", name: "Varanasi", country: "India", continent: "Asia", lat: 25.3069, lng: 83.0107, theme: "Life, ritual and work along the Ganges ghats", lenses: ["culture", "nature"] },
  { id: "hanoi", name: "Hanoi", country: "Vietnam", continent: "Asia", lat: 21.0338, lng: 105.8502, theme: "Old Quarter street life and the motorbike economy", lenses: ["economy", "history"] },
  { id: "ulaanbaatar", name: "Ulaanbaatar", country: "Mongolia", continent: "Asia", lat: 47.9185, lng: 106.9176, theme: "Nomadic heritage in a fast-changing capital", lenses: ["society", "nature"] },
  { id: "istanbul", name: "Istanbul", country: "Türkiye", continent: "Europe", lat: 41.0107, lng: 28.968, theme: "Grand Bazaar: a crossroads of trade for centuries", lenses: ["history", "economy"] },
  { id: "reykjavik", name: "Reykjavík", country: "Iceland", continent: "Europe", lat: 64.1466, lng: -21.9426, theme: "Fire and ice: geothermal life and fishing", lenses: ["nature", "economy"] },
  { id: "rotterdam", name: "Rotterdam", country: "Netherlands", continent: "Europe", lat: 51.92, lng: 4.4866, theme: "Living with water: a port city adapts to climate", lenses: ["nature", "society"] },
  { id: "oaxaca", name: "Oaxaca", country: "Mexico", continent: "North America", lat: 17.0608, lng: -96.7253, theme: "Market day, mole and Zapotec heritage", lenses: ["culture", "economy"] },
  { id: "detroit", name: "Detroit", country: "United States", continent: "North America", lat: 42.3468, lng: -83.041, theme: "Eastern Market and a city reinventing itself", lenses: ["economy", "society"] },
  { id: "cusco", name: "Cusco", country: "Peru", continent: "South America", lat: -13.5163, lng: -71.9785, theme: "Andean highlands, Quechua life and textiles", lenses: ["culture", "history"] },
  { id: "manaus", name: "Manaus", country: "Brazil", continent: "South America", lat: -3.1306, lng: -60.0233, theme: "A city in the Amazon: rivers, rubber and rainforest", lenses: ["nature", "history"] },
  { id: "rotorua", name: "Rotorua", country: "New Zealand", continent: "Oceania", lat: -38.1368, lng: 176.2497, theme: "Māori culture and geothermal landscapes", lenses: ["culture", "nature"] },
];

export function findPostcard(id: string | undefined): Postcard | undefined {
  return id ? POSTCARDS.find((p) => p.id === id) : undefined;
}
