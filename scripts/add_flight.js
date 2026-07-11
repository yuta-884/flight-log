#!/usr/bin/env node
// 便名＋出発日から1便を data/flights.json に追記する。
//
// 使い方:
//   AeroDataBoxで自動解決（要 AERODATABOX_API_KEY 環境変数）:
//     node scripts/add_flight.js <便名> <出発日YYYY-MM-DD> [--from <出発IATA>]
//     例: node scripts/add_flight.js ZG51 2025-07-01
//     --from は同一便名で複数区間が返る場合（国内周回便など）の区間選択用
//
//   手入力フォールバック（APIで解決できない古い便など。APIは呼ばない）:
//     node scripts/add_flight.js --manual <便名> <出発IATA> <到着IATA> <出発日YYYY-MM-DD>
//     例: node scripts/add_flight.js --manual ZG51 NRT BKK 2022-07-15

import {
  loadAirports,
  loadAirlines,
  loadFlights,
  saveFlights,
  routeDistanceKm,
  normalizeLocalTime,
} from './lib.js';

const USAGE = `Usage:
  node scripts/add_flight.js <flight_number> <YYYY-MM-DD> [--from <IATA>]
  node scripts/add_flight.js --manual <flight_number> <origin_IATA> <dest_IATA> <YYYY-MM-DD>`;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const args = process.argv.slice(2);
const manual = args.includes('--manual');
const fromIdx = args.indexOf('--from');
const legFilter = fromIdx !== -1 ? args[fromIdx + 1]?.toUpperCase() : null;
const positional = args.filter((a, i) => !a.startsWith('--') && (fromIdx === -1 || i !== fromIdx + 1));

const airports = loadAirports();
const airlines = loadAirlines();
const flights = loadFlights();

function assertDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(`出発日は YYYY-MM-DD 形式で指定してください: ${s}\n${USAGE}`);
  return s;
}

// 便名（例: ZG51, JL005）→ IATA表記に正規化し、航空会社を解決
function parseFlightNumber(raw) {
  const m = raw.toUpperCase().replace(/\s+/g, '').match(/^([A-Z0-9]{2})(\d+[A-Z]?)$/);
  if (!m) fail(`便名を解釈できません: ${raw}（例: ZG51）`);
  const [, code, num] = m;
  const airline = airlines.find((a) => a.iata === code && a.active) ?? airlines.find((a) => a.iata === code);
  return {
    flightNumber: `${code}${Number.parseInt(num, 10)}${num.match(/[A-Z]$/)?.[0] ?? ''}`,
    airlineCode: code,
    airlineName: airline?.name ?? null,
  };
}

function checkDuplicate(record) {
  if (flights.some((f) => f.id === record.id)) {
    fail(`既に登録済みです: id=${record.id}`);
  }
  const dup = flights.find((f) => f.flight_number === record.flight_number && f.flight_date === record.flight_date);
  if (dup) {
    fail(`同じ便名・日付のフライトが既に存在します（id=${dup.id}, source=${dup.source}）。重複登録を中止しました`);
  }
}

function register(record) {
  checkDuplicate(record);
  flights.push(record);
  saveFlights(flights);
  console.log(`登録しました: ${record.flight_date} ${record.flight_number} ${record.origin_iata}→${record.destination_iata} (${record.distance_km ?? '?'} km, source=${record.source})`);
  console.log(JSON.stringify(record, null, 2));
}

if (manual) {
  const [fn, origin, dest, date] = positional;
  if (!fn || !origin || !dest || !date) fail(USAGE);
  assertDate(date);
  const originIata = origin.toUpperCase();
  const destIata = dest.toUpperCase();
  for (const iata of [originIata, destIata]) {
    if (!airports.has(iata)) fail(`空港マスタに ${iata} がありません（IATA 3レターで指定してください）`);
  }
  const { flightNumber, airlineCode, airlineName } = parseFlightNumber(fn);

  register({
    id: `${date}-${flightNumber}`,
    flight_number: flightNumber,
    flight_date: date,
    airline_code: airlineCode,
    airline_name: airlineName,
    origin_iata: originIata,
    destination_iata: destIata,
    diverted_to_iata: null,
    canceled: false,
    scheduled_departure: null,
    scheduled_arrival: null,
    distance_km: routeDistanceKm(airports, originIata, destIata, null),
    layover: null,
    source: 'manual',
    ops: null,
  });
} else {
  const [fn, date] = positional;
  if (!fn || !date) fail(USAGE);
  assertDate(date);
  const { flightNumber } = parseFlightNumber(fn);

  const apiKey = process.env.AERODATABOX_API_KEY;
  if (!apiKey) fail('環境変数 AERODATABOX_API_KEY が設定されていません（手入力なら --manual を使用）');

  const url = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flightNumber)}/${date}?withAircraftImage=false&withLocation=false`;
  const res = await fetch(url, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
    },
  });

  if (res.status === 204 || res.status === 404) {
    fail(
      `AeroDataBoxで ${flightNumber} (${date}) を解決できませんでした（該当便なし）。\n` +
        `便名・日付（出発地ローカル）を確認するか、手入力で登録してください:\n` +
        `  node scripts/add_flight.js --manual ${flightNumber} <出発IATA> <到着IATA> ${date}`
    );
  }
  if (res.status === 401 || res.status === 403) fail(`AeroDataBox APIキーが無効です (HTTP ${res.status})。AERODATABOX_API_KEY を確認してください`);
  if (res.status === 429) fail('AeroDataBoxのレート制限/月間クォータ (600 units) に達しています (HTTP 429)');
  if (!res.ok) fail(`AeroDataBox APIエラー: HTTP ${res.status} ${await res.text()}`);

  let legs = await res.json();
  if (!Array.isArray(legs)) legs = [legs];
  legs = legs.filter((l) => l?.departure?.airport?.iata && l?.arrival?.airport?.iata);

  // AeroDataBoxは指定日に「出発する便」と「到着する便」の両方を返す
  // （深夜便では前日発の便が混ざる）。正準日付＝出発地ローカルの出発日なので、
  // 出発ローカル日付が一致する区間に絞る。時刻不明の区間しか無い場合はそのまま残す
  const sameDay = legs.filter((l) => normalizeLocalTime(l.departure.scheduledTime?.local)?.startsWith(date));
  if (sameDay.length > 0) legs = sameDay;
  if (legs.length === 0) {
    fail(`AeroDataBoxのレスポンスに有効な区間がありません。--manual での登録を検討してください`);
  }
  if (legFilter) legs = legs.filter((l) => l.departure.airport.iata === legFilter);
  if (legs.length === 0) fail(`--from ${legFilter} に一致する区間がありません`);
  if (legs.length > 1) {
    console.error(`${flightNumber} (${date}) は複数区間が見つかりました。--from <出発IATA> で区間を指定してください:`);
    for (const l of legs) console.error(`  ${l.departure.airport.iata} → ${l.arrival.airport.iata}`);
    process.exit(1);
  }

  const leg = legs[0];
  const dep = leg.departure;
  const arr = leg.arrival;
  const airline = airlines.find((a) => a.iata === leg.airline?.iata) ?? null;

  register({
    id: `${date}-${flightNumber}`,
    flight_number: flightNumber,
    flight_date: date,
    airline_code: leg.airline?.iata ?? flightNumber.slice(0, 2),
    airline_name: leg.airline?.name ?? airline?.name ?? null,
    origin_iata: dep.airport.iata,
    destination_iata: arr.airport.iata,
    diverted_to_iata: null, // AeroDataBoxはダイバート先空港を返さない。必要ならJSON直接編集
    canceled: leg.status === 'Canceled',
    scheduled_departure: normalizeLocalTime(dep.scheduledTime?.local),
    scheduled_arrival: normalizeLocalTime(arr.scheduledTime?.local),
    distance_km: routeDistanceKm(airports, dep.airport.iata, arr.airport.iata, null),
    layover: null,
    source: 'api',
    ops: {
      dep_terminal: dep.terminal ?? null,
      dep_gate: dep.gate ?? null,
      arr_terminal: arr.terminal ?? null,
      arr_gate: arr.gate ?? null,
      aircraft_type: leg.aircraft?.model ?? null,
      tail_number: leg.aircraft?.reg ?? null,
      actual_gate_departure: normalizeLocalTime(dep.revisedTime?.local),
      actual_takeoff: normalizeLocalTime(dep.runwayTime?.local),
      actual_landing: normalizeLocalTime(arr.runwayTime?.local),
      actual_gate_arrival: normalizeLocalTime(arr.revisedTime?.local),
    },
  });
}
