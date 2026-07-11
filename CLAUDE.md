# flight-log

個人フライトログのWebアプリ。「ログ＋統計＋地球儀ビジュアライズ」に特化し、リアルタイム系機能（遅延通知・搭乗リマインド等）は持たない。正準仕様は `docs/flight-log-spec.md`（v0.2確定版）。本ファイルはその要点の恒久的なプロジェクト文脈。

## 設計原則

- **アーキテクチャは案B': GitHub Pages + GitHub Actions**。ホスティングコストゼロ、サーバーなし
- **認証機構なし**: リポジトリへのコミット権限そのものが認証。サイトは完全公開
- **表示・集計は完全API非依存**: AeroDataBox APIは登録時に一度だけ呼び、解決結果を `data/flights.json` に保存する。サイト表示・統計集計でAPIを呼ぶことは絶対にない（オフラインでもビルド・表示可能）
- **`data/flights.json` が唯一の正準データストア**。Gitの履歴が監査ログを兼ね、このファイルがそのままエクスポート形式
- 編集・削除はJSON直接編集で行う（頻度が低いので専用UIは作らない）

## 確定済み設計判断（再議論しない）

| 論点 | 決定 |
|---|---|
| 国のカウント対象 | 出発・到着**両方**の空港の所在国 |
| 乗り継ぎの扱い | 「乗り継ぎ含む」「乗り継ぎ除く」の**両方を並記** |
| 年の基準 | **出発地ローカルの出発日**（`flight_date` が正準日付） |
| 往復 | 往路・復路で2フライトとして単純カウント |
| 初期移行 | Flighty CSVエクスポートのインポート |
| 公開範囲 | 完全公開。アクセス制御は必要になったら後付け |

**乗り継ぎ自動判定ロジック**: フライトNの到着空港 = フライトN+1の出発空港（空港コードの**厳密一致**）かつ間隔が閾値（デフォルト24時間）以内なら、中間空港の国を「乗り継ぎ」とみなす。フライトごとに `layover: true/false` で手動オーバーライド可（`null` = 自動判定）。同一都市・別空港（SAW→IST等）は意図的に乗り継ぎ扱いに**しない**（地上移動=入国の近似）。同一都市判定への拡張は行わない。

## データモデル（flights.json の1レコード）

```jsonc
{
  "id": "4b27f0a9-...",                 // Flighty便はFlighty ID、API/手動便は "YYYY-MM-DD-便名"
  "flight_number": "ZG51",              // IATA表記に正規化
  "flight_date": "2022-07-15",          // 出発地ローカルの出発日（正準日付）
  "airline_code": "ZG",                 // IATA（インポート時にICAO→IATA解決）
  "airline_name": "ZIPAIR Tokyo",
  "origin_iata": "NRT",
  "destination_iata": "BKK",
  "diverted_to_iata": null,             // 値がある場合、距離・国カウントの実効到着地
  "canceled": false,                    // trueの便は統計から除外（レコードは保持）
  "scheduled_departure": "2022-07-15T17:05",  // ローカル時刻のナイーブ文字列（TZオフセットなし）
  "scheduled_arrival": "2022-07-15T21:45",
  "distance_km": 4611,                  // 登録・インポート時にHaversineで計算して保存
  "layover": null,                      // null=自動判定 / true / false で手動上書き
  "source": "flighty_import",           // "api" | "manual" | "flighty_import"
  "ops": {                              // 任意。AeroDataBoxで扱える運航データのみ
    "dep_terminal": "1N", "dep_gate": "23",
    "arr_terminal": null, "arr_gate": null,
    "aircraft_type": "Boeing 787-8", "tail_number": "JA825J",
    "actual_gate_departure": "2022-07-15T17:04",
    "actual_takeoff": "2022-07-15T17:21",
    "actual_landing": "2022-07-15T21:11",
    "actual_gate_arrival": "2022-07-15T21:21"
  }
}
```

- `ops` は拡張領域。現行統計は参照しない。Flightyインポート時はCSVから、API登録時はAeroDataBoxレスポンスから**同じスキーマ**で埋める（新旧フライトの構造統一が目的）
- 個人記録系（PNR/座席/クラス/搭乗理由/メモ）は**保存しない**。`Flight Flighty ID` のみ重複防止キーとして `id` に流用
- `data/airports.json`: `iata, name, city, country_code, country_name, lat, lon`（OpenFlightsから生成、同梱）
- `data/airlines.json`: ICAO→IATA・名称解決用の航空会社マスタ（OpenFlightsから生成、同梱）
- `stats.json`: Phase 2で `build_stats.js` がビルド時に生成。サイト・埋め込みカードはこれだけを読む

## 外部API（AeroDataBox / RapidAPI）

- `GET https://aerodatabox.p.rapidapi.com/flights/number/{flightNumber}/{dateLocal}`
- ヘッダー: `X-RapidAPI-Key`（Secrets の `AERODATABOX_API_KEY`）、`X-RapidAPI-Host: aerodatabox.p.rapidapi.com`
- BASICプラン（無料、月600ユニット）。呼ぶのは `scripts/add_flight.js` のみ

## ディレクトリ構成

```
├── data/
│   ├── flights.json        # フライトの正準データ
│   ├── airports.json       # 空港マスタ（OpenFlights由来）
│   └── airlines.json       # 航空会社マスタ（同上）
├── scripts/
│   ├── generate_masters.js # OpenFlights → airports.json / airlines.json
│   ├── add_flight.js       # 便名+日付 → AeroDataBox解決 → flights.json追記（--manual あり）
│   ├── import_flighty.js   # Flighty CSV → flights.json（Flighty IDで冪等）
│   └── build_stats.js      # (Phase 2) flights.json → stats.json
├── site/                   # 静的サイト（Phase 1はプレースホルダー）
└── .github/workflows/
    ├── add-flight.yml      # workflow_dispatch: 便名+日付で登録・コミット
    └── deploy.yml          # main更新でPagesデプロイ
```

## 技術制約

- スクリプトはNode.js（LTS）、ESM。フレームワーク不使用、外部依存は `csv-parse` 程度に留める
- HTTPはNode組み込みの `fetch` を使う
- 距離は必ず登録・インポート時にHaversineで計算して `distance_km` に保存（表示時に計算しない）

## Flighty CSV（実ファイル確認済み）

ヘッダー: `Date,Airline,Flight,From,To,Dep Terminal,Dep Gate,Arr Terminal,Arr Gate,Canceled,Diverted To,Gate Departure (Scheduled),Gate Departure (Actual),Take off (Scheduled),Take off (Actual),Landing (Scheduled),Landing (Actual),Gate Arrival (Scheduled),Gate Arrival (Actual),Aircraft Type Name,Tail Number,PNR,Seat,Seat Type,Cabin Class,Flight Reason,Notes,Flight Flighty ID,Airline Flighty ID,Departure Airport Flighty ID,Arrival Airport Flighty ID,Diverted To Airport Flighty ID,Aircraft Type Flighty ID`

- `Airline` はICAOコード（例: TZP）、`Flight` は番号のみ（例: 51）→ `flight_number` はIATA+番号に整形（ZG51）
- 時刻はTZオフセットなしのナイーブISO（`2022-07-15T17:05`）
- `Gate Departure (Scheduled)` → `scheduled_departure`、`Gate Arrival (Scheduled)` → `scheduled_arrival`

## フェーズ計画

| フェーズ | 内容 | 状態 |
|---|---|---|
| Phase 1 | データモデル、マスタ生成、`import_flighty.js`、`add_flight.js`、workflow_dispatch登録、Pagesデプロイ骨格 | 実装中 |
| Phase 2 | `build_stats.js` と統計ページ（5項目、通算・年別、乗り継ぎ含む/除く） | 未着手 |
| Phase 3 | 地球儀ビュー（globe.gl、大圏アーク描画） | 未着手 |
| Phase 4 | 埋め込みカード `/embed/stats.html`（Ghostブログへiframe埋め込み） | 未着手 |

登録フロー（スマホ運用）: GitHubモバイルアプリ → Actions → add-flight → Run workflow → 便名と日付を入力 → ActionがAPI解決してコミット → Pagesが自動再ビルド。
