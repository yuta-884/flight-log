#!/usr/bin/env node
// OpenFlightsの公開データから data/airports.json と data/airlines.json を生成する。
//
// 使い方:
//   node scripts/generate_masters.js
//
// 生成物はリポジトリに同梱する（表示・集計を完全にAPI/ネットワーク非依存にするため）。
// 再生成が必要になるのは新空港・新航空会社が現れたときだけ。

import { parse } from 'csv-parse/sync';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

const BASE = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data';
const SOURCES = {
  airports: `${BASE}/airports.dat`,
  airlines: `${BASE}/airlines.dat`,
  countries: `${BASE}/countries.dat`,
};

async function fetchDat(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  const text = await res.text();
  // OpenFlightsの.datはヘッダーなしCSV。\N がnull表現
  return parse(text, { relax_quotes: true, relax_column_count: true }).map((row) =>
    row.map((v) => (v === '\\N' || v === '' ? null : v))
  );
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const [airportRows, airlineRows, countryRows] = await Promise.all([
  fetchDat(SOURCES.airports),
  fetchDat(SOURCES.airlines),
  fetchDat(SOURCES.countries),
]);

// countries.dat: name, iso_code, dafif_code
const countryToIso = new Map();
for (const [name, iso] of countryRows) {
  if (name && iso) countryToIso.set(name, iso);
}

// airports.dat: id, name, city, country, iata, icao, lat, lon, alt, tz_offset, dst, tz, type, source
const airports = [];
const seenIata = new Set();
let missingIso = 0;
for (const row of airportRows) {
  const [, name, city, country, iata, , lat, lon] = row;
  if (!iata || !/^[A-Z]{3}$/.test(iata) || seenIata.has(iata)) continue;
  const country_code = countryToIso.get(country) ?? null;
  if (!country_code) missingIso++;
  seenIata.add(iata);
  airports.push({
    iata,
    name,
    city,
    country_code,
    country_name: country,
    lat: num(lat),
    lon: num(lon),
  });
}
airports.sort((a, b) => a.iata.localeCompare(b.iata));

// airlines.dat: id, name, alias, iata, icao, callsign, country, active
// ICAO→IATA・名称解決用。同一ICAOが複数ある場合はactive=Yを優先
const byIcao = new Map();
for (const row of airlineRows) {
  const [, name, , iata, icao, , , active] = row;
  if (!icao || !/^[A-Z0-9]{3}$/.test(icao) || !name) continue;
  const entry = { icao, iata: iata && /^[A-Z0-9]{2}$/.test(iata) ? iata : null, name, active: active === 'Y' };
  const prev = byIcao.get(icao);
  if (!prev || (!prev.active && entry.active)) byIcao.set(icao, entry);
}
// OpenFlightsは航空会社データの更新が止まっている（ZIPAIR等の新会社の欠落、
// APJ→"Air Print"のような誤ったコード再割当が残存）ため、手動メンテの
// airline_overrides.json をICAO一致でマージする。オーバーライドが常に優先。
const overrides = JSON.parse(readFileSync(join(DATA_DIR, 'airline_overrides.json'), 'utf8'));
for (const o of overrides) byIcao.set(o.icao, o);
const airlines = [...byIcao.values()].sort((a, b) => a.icao.localeCompare(b.icao));

writeFileSync(join(DATA_DIR, 'airports.json'), JSON.stringify(airports, null, 2) + '\n');
writeFileSync(join(DATA_DIR, 'airlines.json'), JSON.stringify(airlines, null, 2) + '\n');

console.log(`airports.json: ${airports.length} airports (ISO code unresolved: ${missingIso})`);
console.log(`airlines.json: ${airlines.length} airlines`);
