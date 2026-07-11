#!/usr/bin/env node
// data/flights.json → data/stats.json（集計済み統計）を生成する（仕様書§3.2）
//
// 使い方:
//   node scripts/build_stats.js [出力パス]   # 省略時 data/stats.json
//
// 集計ルール:
// - canceled=true の便は全統計から除外（レコードは保持されるが飛んでいない）
// - 未来の便（flight_dateが集計日より後）も全統計から除外。予定便は保持され、
//   出発日到来後の再ビルドで自動算入。出発日当日は搭乗済み扱い（Flightyと同基準）
// - diverted_to_iata があれば距離・国カウントの実効到着地として使う
// - 「滞在」モデルで国をカウントする: 最初の便の出発地、各便の実効到着地、
//   および前便の到着地と不一致の出発地（陸路移動）をそれぞれ1滞在とする。
//   往復1回の訪問は滞在1回と数える（便の端点ごとに数えると二重計上になる）
// - 乗り継ぎ判定: フライトNの layover フラグは「Nの到着後の滞在」を指す。
//   null（自動）の場合、次便の出発空港がNの実効到着地と厳密一致し、かつ
//   到着→出発の間隔が閾値（24時間）以内なら乗り継ぎ。
//   同一空港での接続は同一タイムゾーンなので、ナイーブなローカル時刻の差が
//   そのまま正確な経過時間になる。時刻が欠けている便（手動登録等）は
//   flight_date の差が1日以内なら乗り継ぎとみなすフォールバック

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, loadAirports, loadFlights } from './lib.js';

const LAYOVER_THRESHOLD_HOURS = 24;

const outPath = process.argv[2] ?? join(DATA_DIR, 'stats.json');

const airports = loadAirports();
const warnings = [];

// 時系列に並べた有効な便（キャンセルと未来の便を除く）
const today = new Date().toISOString().slice(0, 10);
const flights = loadFlights()
  .filter((f) => !f.canceled && f.flight_date <= today)
  .sort(
    (a, b) =>
      a.flight_date.localeCompare(b.flight_date) ||
      String(a.scheduled_departure ?? '').localeCompare(String(b.scheduled_departure ?? ''))
  );

const effDest = (f) => f.diverted_to_iata || f.destination_iata;

function countryOf(iata) {
  const a = airports.get(iata);
  if (!a?.country_code) {
    warnings.push(`空港 ${iata} の国を解決できません（airports.jsonを確認）`);
    return null;
  }
  return { code: a.country_code, name: a.country_name };
}

function parseNaive(s) {
  return s ? Date.parse(`${s}:00Z`) : null; // 同一空港同士の差分にのみ使う（TZは相殺）
}

// フライトi の到着後の滞在が乗り継ぎかどうか
function isLayoverStay(f, next) {
  if (f.layover !== null) return f.layover; // 手動オーバーライド優先
  if (!next || next.origin_iata !== effDest(f)) return false; // 空港コード厳密一致
  const arr = parseNaive(f.scheduled_arrival);
  const dep = parseNaive(next.scheduled_departure);
  if (arr !== null && dep !== null) {
    const hours = (dep - arr) / 3600000;
    return hours >= 0 && hours <= LAYOVER_THRESHOLD_HOURS;
  }
  // 時刻欠損時のフォールバック: 日付差1日以内なら乗り継ぎ扱い
  const dayDiff = (Date.parse(next.flight_date) - Date.parse(f.flight_date)) / 86400000;
  return dayDiff <= 1;
}

// 滞在リストを構築
const stays = []; // { iata, country: {code,name}|null, layover: boolean }
if (flights.length > 0) {
  stays.push({ iata: flights[0].origin_iata, country: countryOf(flights[0].origin_iata), layover: false });
}
for (let i = 0; i < flights.length; i++) {
  const f = flights[i];
  const next = flights[i + 1] ?? null;
  // 陸路移動の不連続（前便の到着地≠出発地）は独立した滞在。到着地側の滞在として
  // 既にカウントされないため、出発地を訪問として追加する（SAW→IST等の設計意図どおり）
  if (i > 0 && f.origin_iata !== effDest(flights[i - 1])) {
    stays.push({ iata: f.origin_iata, country: countryOf(f.origin_iata), layover: false });
  }
  const dest = effDest(f);
  stays.push({ iata: dest, country: countryOf(dest), layover: isLayoverStay(f, next) });
}

// 総飛行時間: 実離着陸 → ゲート実時刻 → 予定時刻 の順で使えるペアを採用し、
// 空港マスタのtz database名でナイーブなローカル時刻をUTCに換算して差を取る
const tzCache = new Map();
function localToUtcMs(naive, tz) {
  let dtf = tzCache.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    tzCache.set(tz, dtf);
  }
  const guess = Date.parse(`${naive}:00Z`);
  const p = Object.fromEntries(dtf.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - guess;
  return guess - offset; // DST境界±1時間の誤差は統計用途では無視できる
}

function flightMinutes(f) {
  const oTz = airports.get(f.origin_iata)?.tz;
  const dTz = airports.get(effDest(f))?.tz;
  if (!oTz || !dTz) {
    warnings.push(`${f.flight_number} ${f.flight_date}: 空港tzが不明で飛行時間を計算できません`);
    return null;
  }
  const pairs = [
    [f.ops?.actual_takeoff, f.ops?.actual_landing],
    [f.ops?.actual_gate_departure, f.ops?.actual_gate_arrival],
    [f.scheduled_departure, f.scheduled_arrival],
  ];
  for (const [dep, arr] of pairs) {
    if (!dep || !arr) continue;
    const min = Math.round((localToUtcMs(arr, dTz) - localToUtcMs(dep, oTz)) / 60000);
    if (min > 0 && min < 20 * 60) return min; // 不正値（負・20時間超）は次の候補へ
  }
  warnings.push(`${f.flight_number} ${f.flight_date}: 有効な時刻ペアがなく飛行時間から除外`);
  return null;
}

let totalFlightMinutes = 0;
let flightTimeCounted = 0;
for (const f of flights) {
  const min = flightMinutes(f);
  if (min !== null) {
    totalFlightMinutes += min;
    flightTimeCounted++;
  }
}

// Top Airports（発着それぞれ1カウント、実効到着地ベース）/ Top Airlines（便数）
const airportCounts = new Map();
const airlineCounts = new Map();
for (const f of flights) {
  for (const iata of [f.origin_iata, effDest(f)]) {
    const cur = airportCounts.get(iata) ?? { iata, city: airports.get(iata)?.city ?? null, count: 0 };
    cur.count++;
    airportCounts.set(iata, cur);
  }
  const key = f.airline_code;
  const cur = airlineCounts.get(key) ?? { code: key, name: f.airline_name, count: 0 };
  cur.count++;
  airlineCounts.set(key, cur);
}
const topAirports = [...airportCounts.values()].sort((a, b) => b.count - a.count || a.iata.localeCompare(b.iata));
const topAirlines = [...airlineCounts.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

// 国別の滞在回数（乗り継ぎ含む／除く）
function countryVisits(includeLayovers) {
  const visits = new Map(); // code -> { code, name, visits }
  for (const s of stays) {
    if (!s.country || (!includeLayovers && s.layover)) continue;
    const cur = visits.get(s.country.code) ?? { country_code: s.country.code, country_name: s.country.name, visits: 0 };
    cur.visits++;
    visits.set(s.country.code, cur);
  }
  return [...visits.values()].sort((a, b) => b.visits - a.visits || a.country_code.localeCompare(b.country_code));
}

const visitsIncl = countryVisits(true);
const visitsExcl = countryVisits(false);

// 年別内訳（年＝出発地ローカル出発日の年）
const byYear = {};
for (const f of flights) {
  const y = f.flight_date.slice(0, 4);
  byYear[y] ??= { flights: 0, distance_km: 0 };
  byYear[y].flights++;
  if (f.distance_km === null) warnings.push(`${f.flight_number} ${f.flight_date}: distance_km がnullのため距離集計から漏れます`);
  byYear[y].distance_km += f.distance_km ?? 0;
}

const totalDistance = Object.values(byYear).reduce((s, y) => s + y.distance_km, 0);

const stats = {
  generated_at: new Date().toISOString(),
  counted_through: today, // この日以前の出発便のみ集計対象
  layover_threshold_hours: LAYOVER_THRESHOLD_HOURS,
  total_flights: flights.length,
  flights_by_year: byYear,
  countries: {
    including_layovers: { count: visitsIncl.length, visits: visitsIncl },
    excluding_layovers: { count: visitsExcl.length, visits: visitsExcl },
  },
  total_distance_km: totalDistance,
  flight_time: {
    total_minutes: totalFlightMinutes,
    flights_counted: flightTimeCounted, // 時刻データがあり集計に入った便数
  },
  top_airports: topAirports,
  top_airlines: topAirlines,
};

writeFileSync(outPath, JSON.stringify(stats, null, 2) + '\n');

console.log(`stats.json generated: ${outPath}`);
console.log(`  flights: ${stats.total_flights}, distance: ${totalDistance} km`);
console.log(`  countries: incl=${visitsIncl.length}, excl=${visitsExcl.length}`);
console.log(`  flight time: ${Math.floor(totalFlightMinutes / 60)}h ${totalFlightMinutes % 60}m (${flightTimeCounted}/${flights.length} flights)`);
console.log(`  top airport: ${topAirports[0]?.iata}(${topAirports[0]?.count}), top airline: ${topAirlines[0]?.code}(${topAirlines[0]?.count})`);
for (const w of warnings) console.warn(`WARN: ${w}`);
