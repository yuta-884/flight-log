#!/usr/bin/env node
// Flighty CSVエクスポート → data/flights.json 変換（仕様書§3.1のマッピング表に準拠）
//
// 使い方:
//   node scripts/import_flighty.js <FlightyExport.csv>
//
// - `Flight Flighty ID` を id に使い、既存idはスキップ（再実行しても重複しない＝冪等）
// - 個人記録系カラム（PNR/座席/クラス/搭乗理由/メモ/各種Flighty ID）は破棄
// - 距離は airports.json の座標からHaversineで計算して保存

import { parse } from 'csv-parse/sync';
import { readFileSync } from 'node:fs';
import {
  loadAirports,
  loadAirlines,
  loadFlights,
  saveFlights,
  routeDistanceKm,
  normalizeLocalTime,
} from './lib.js';

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node scripts/import_flighty.js <FlightyExport.csv>');
  process.exit(1);
}

const rows = parse(readFileSync(csvPath, 'utf8'), {
  columns: true,
  bom: true,
  skip_empty_lines: true,
  trim: true,
});

const airports = loadAirports();
const airlines = loadAirlines();
const byIcao = new Map(airlines.map((a) => [a.icao, a]));

const flights = loadFlights();
const existingIds = new Set(flights.map((f) => f.id));

const empty = (v) => (v === '' || v === undefined ? null : v);
const warnings = [];
let added = 0;
let skipped = 0;

for (const row of rows) {
  const id = row['Flight Flighty ID'];
  if (!id) {
    warnings.push(`Flight Flighty ID がない行をスキップ: ${row['Date']} ${row['Airline']}${row['Flight']}`);
    continue;
  }
  if (existingIds.has(id)) {
    skipped++;
    continue;
  }

  // Airline はICAOコード（例: TZP）。マスタでIATA・名称に解決
  const icao = row['Airline'];
  const airline = byIcao.get(icao);
  if (!airline?.iata) {
    warnings.push(`ICAO ${icao} をIATAに解決できません（${row['Date']} ${icao}${row['Flight']}）。airline_overrides.json に追加してください`);
  }
  const airlineCode = airline?.iata ?? icao;

  // Flight は番号のみ（例: 51）→ IATA表記に整形（ZG51）
  const flightNumber = `${airlineCode}${row['Flight']}`;

  const origin = row['From'];
  const destination = row['To'];
  const diverted = empty(row['Diverted To']);
  const distance = routeDistanceKm(airports, origin, destination, diverted);
  if (distance === null) {
    warnings.push(`${flightNumber} ${row['Date']}: 空港マスタに座標がなく distance_km を計算できません（${origin}→${diverted ?? destination}）`);
  }

  flights.push({
    id,
    flight_number: flightNumber,
    flight_date: row['Date'],
    airline_code: airlineCode,
    airline_name: airline?.name ?? null,
    origin_iata: origin,
    destination_iata: destination,
    diverted_to_iata: diverted,
    canceled: String(row['Canceled']).toLowerCase() === 'true',
    scheduled_departure: normalizeLocalTime(row['Gate Departure (Scheduled)']),
    scheduled_arrival: normalizeLocalTime(row['Gate Arrival (Scheduled)']),
    distance_km: distance,
    layover: null,
    source: 'flighty_import',
    // 運航データ（ターミナル・ゲート・機材・実時刻）は保存しない。統計は事実フィールドと
    // ローカル計算のみで成立し、飛行時間は公表スケジュールから算出する（正準モデル統一のため）
  });
  existingIds.add(id);
  added++;
}

saveFlights(flights);

console.log(`imported: ${added}, skipped (already present): ${skipped}, total: ${flights.length}`);
for (const w of warnings) console.warn(`WARN: ${w}`);
if (warnings.length > 0) process.exitCode = 2;
