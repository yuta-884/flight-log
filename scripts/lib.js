// add_flight.js / import_flighty.js 共通のユーティリティ
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
export const FLIGHTS_PATH = join(DATA_DIR, 'flights.json');

export function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadAirports() {
  const map = new Map();
  for (const a of loadJson(join(DATA_DIR, 'airports.json'))) map.set(a.iata, a);
  return map;
}

export function loadAirlines() {
  return loadJson(join(DATA_DIR, 'airlines.json'));
}

export function loadFlights() {
  return loadJson(FLIGHTS_PATH);
}

export function saveFlights(flights) {
  // 正準日付 → 出発時刻 → id の順で安定ソートして保存（差分を読みやすく保つ）
  flights.sort(
    (a, b) =>
      a.flight_date.localeCompare(b.flight_date) ||
      String(a.scheduled_departure ?? '').localeCompare(String(b.scheduled_departure ?? '')) ||
      a.id.localeCompare(b.id)
  );
  writeFileSync(FLIGHTS_PATH, JSON.stringify(flights, null, 2) + '\n');
}

// 大圏距離（Haversine, km）。登録・インポート時に計算して保存する（表示時には計算しない）
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 出発地 → 実効到着地（diverted_to優先）の距離。空港マスタに無ければnull
export function routeDistanceKm(airports, originIata, destIata, divertedIata) {
  const o = airports.get(originIata);
  const d = airports.get(divertedIata || destIata);
  if (!o || !d || o.lat == null || d.lat == null) return null;
  return Math.round(haversineKm(o.lat, o.lon, d.lat, d.lon));
}

// ローカル時刻文字列を "YYYY-MM-DDTHH:mm" のナイーブ表記に正規化
// 入力例: "2022-07-15T17:05:00", "2022-07-15 17:05+09:00", "2022-07-15T17:05"
export function normalizeLocalTime(s) {
  if (!s) return null;
  const m = String(s).trim().replace(' ', 'T').match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  return m ? m[1] : null;
}
