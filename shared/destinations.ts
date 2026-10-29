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
  { id: "addis-ababa", name: "Addis Ababa", country: "Ethiopia", continent: "Africa", lat: 9.0353, lng: 38.7369, theme: "Merkato, coffee ceremonies and a city of many languages", lenses: ["economy", "culture"] },
  { id: "lagos", name: "Lagos", country: "Nigeria", continent: "Africa", lat: 6.456, lng: 3.39, theme: "Balogun Market, Afrobeats and a megacity's hustle", lenses: ["economy", "society"] },
  { id: "stone-town", name: "Stone Town", country: "Tanzania", continent: "Africa", lat: -6.163, lng: 39.189, theme: "Zanzibar's carved doors, spice trade and Swahili coast life", lenses: ["history", "culture"] },
  { id: "cape-town", name: "Cape Town", country: "South Africa", continent: "Africa", lat: -33.9203, lng: 18.4153, theme: "Bo-Kaap, the harbour and a city that faced Day Zero", lenses: ["history", "nature"] },
  { id: "kyoto", name: "Kyoto", country: "Japan", continent: "Asia", lat: 35.005, lng: 135.7649, theme: "Nishiki Market: tradition meets tourism pressure", lenses: ["culture", "society"] },
  { id: "varanasi", name: "Varanasi", country: "India", continent: "Asia", lat: 25.3069, lng: 83.0107, theme: "Life, ritual and work along the Ganges ghats", lenses: ["culture", "nature"] },
  { id: "hanoi", name: "Hanoi", country: "Vietnam", continent: "Asia", lat: 21.0338, lng: 105.8502, theme: "Old Quarter street life and the motorbike economy", lenses: ["economy", "history"] },
  { id: "ulaanbaatar", name: "Ulaanbaatar", country: "Mongolia", continent: "Asia", lat: 47.9185, lng: 106.9176, theme: "Nomadic heritage in a fast-changing capital", lenses: ["society", "nature"] },
  { id: "seoul", name: "Seoul", country: "South Korea", continent: "Asia", lat: 37.5701, lng: 126.9998, theme: "Gwangjang Market: food stalls, family trades and fast change", lenses: ["economy", "society"] },
  { id: "chengdu", name: "Chengdu", country: "China", continent: "Asia", lat: 30.6578, lng: 104.0562, theme: "Teahouses, mahjong and a slow-living culture", lenses: ["society", "culture"] },
  { id: "yogyakarta", name: "Yogyakarta", country: "Indonesia", continent: "Asia", lat: -7.7928, lng: 110.3658, theme: "Batik, gamelan and a royal city's street life", lenses: ["culture", "history"] },
  { id: "istanbul", name: "Istanbul", country: "Türkiye", continent: "Europe", lat: 41.0107, lng: 28.968, theme: "Grand Bazaar: a crossroads of trade for centuries", lenses: ["history", "economy"] },
  { id: "reykjavik", name: "Reykjavík", country: "Iceland", continent: "Europe", lat: 64.1466, lng: -21.9426, theme: "Fire and ice: geothermal life and fishing", lenses: ["nature", "economy"] },
  { id: "rotterdam", name: "Rotterdam", country: "Netherlands", continent: "Europe", lat: 51.92, lng: 4.4866, theme: "Living with water: a port city adapts to climate", lenses: ["nature", "society"] },
  { id: "lisbon", name: "Lisbon", country: "Portugal", continent: "Europe", lat: 38.711, lng: -9.131, theme: "Alfama's fado, trams and life on the hills", lenses: ["culture", "history"] },
  { id: "naples", name: "Naples", country: "Italy", continent: "Europe", lat: 40.8497, lng: 14.255, theme: "Spaccanapoli: street food, saints and a volcano next door", lenses: ["culture", "nature"] },
  { id: "krakow", name: "Kraków", country: "Poland", continent: "Europe", lat: 50.0617, lng: 19.9374, theme: "The Main Square, Kazimierz and living with memory", lenses: ["history", "society"] },
  { id: "oaxaca", name: "Oaxaca", country: "Mexico", continent: "North America", lat: 17.0608, lng: -96.7253, theme: "Market day, mole and Zapotec heritage", lenses: ["culture", "economy"] },
  { id: "detroit", name: "Detroit", country: "United States", continent: "North America", lat: 42.3468, lng: -83.041, theme: "Eastern Market and a city reinventing itself", lenses: ["economy", "society"] },
  { id: "montreal", name: "Montréal", country: "Canada", continent: "North America", lat: 45.5362, lng: -73.6146, theme: "Jean-Talon Market and life in two languages", lenses: ["society", "economy"] },
  { id: "new-orleans", name: "New Orleans", country: "United States", continent: "North America", lat: 29.9574, lng: -90.0629, theme: "Brass bands, Mardi Gras traditions and living with hurricanes", lenses: ["culture", "nature"] },
  { id: "havana", name: "Havana", country: "Cuba", continent: "North America", lat: 23.138, lng: -82.3503, theme: "Old Havana: classic cars, ration books and small businesses", lenses: ["economy", "history"] },
  { id: "cusco", name: "Cusco", country: "Peru", continent: "South America", lat: -13.5163, lng: -71.9785, theme: "Andean highlands, Quechua life and textiles", lenses: ["culture", "history"] },
  { id: "manaus", name: "Manaus", country: "Brazil", continent: "South America", lat: -3.1306, lng: -60.0233, theme: "A city in the Amazon: rivers, rubber and rainforest", lenses: ["nature", "history"] },
  { id: "la-paz", name: "La Paz", country: "Bolivia", continent: "South America", lat: -16.4957, lng: -68.1335, theme: "Cable cars, Aymara traders and life at 3,600 metres", lenses: ["society", "nature"] },
  { id: "valparaiso", name: "Valparaíso", country: "Chile", continent: "South America", lat: -33.043, lng: -71.628, theme: "Hillside murals, funiculars and a working port", lenses: ["culture", "economy"] },
  { id: "medellin", name: "Medellín", country: "Colombia", continent: "South America", lat: 6.2568, lng: -75.616, theme: "Comuna 13: outdoor escalators, graffiti and a neighbourhood's comeback", lenses: ["society", "history"] },
  { id: "rotorua", name: "Rotorua", country: "New Zealand", continent: "Oceania", lat: -38.1368, lng: 176.2497, theme: "Māori culture and geothermal landscapes", lenses: ["culture", "nature"] },
  { id: "suva", name: "Suva", country: "Fiji", continent: "Oceania", lat: -18.1366, lng: 178.4243, theme: "The municipal market, kava circles and rising seas", lenses: ["nature", "economy"] },
  { id: "apia", name: "Apia", country: "Samoa", continent: "Oceania", lat: -13.834, lng: -171.766, theme: "Faʻa Samoa: family, church and the village council", lenses: ["culture", "society"] },
];

export function findPostcard(id: string | undefined): Postcard | undefined {
  return id ? POSTCARDS.find((p) => p.id === id) : undefined;
}
