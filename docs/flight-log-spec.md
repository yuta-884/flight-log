# フライトログ Webアプリ 要件・仕様書（v0.17 確定版）

## §0. v0.17の変更（AeroDataBox利用規約への対応）

AeroDataBoxの利用規約は、取得したContents（運航データ）の永続保存・公開表示を禁じている（詳細はマルチユーザー版 flight-logger のspec §10）。本アプリはカード等を公開前提で構築しているため、AeroDataBox独自の運航データを保存・表示しない方針に変更する。

- **運航データ（ops）を廃止**: `import_flighty.js` / `add_flight.js` は ops を書き込まない。既存 `flights.json` からも ops を除去済み（元データはユーザーのFlighty CSVから復元可能）
- **総飛行時間を予定ベースに変更**: 実測時刻ではなく公表スケジュール（`scheduled_departure`→`scheduled_arrival`）から予定ブロックタイムで算出。本アプリは搭乗記録であり遅延追跡ではないため実測は要件外
- 保持するデータ: 事実フィールド（便名・日付・区間・航空会社・公表スケジュール）＋ローカル計算値（距離・国・座標）のみ
- 表示への影響: 機材/ゲート/ターミナル/機体番号は元々どの画面にも非表示のため影響なし。総飛行時間のみ実測→予定ベースに変化

v0.15からの変更: 統計ページと埋め込みカードにOGPメタタグ（og:title / description / type / url）を追加。og:imageは採用しない（プラットフォームごとのクロップ最適化はやめた。note.com等のiframe不可のプラットフォームではテキストのリンクカードで共有する）。

v0.14からの変更: 埋め込みカードをオリジナルデザインに刷新。パスポートメタファー（紙地・表紙枠・PASSPORT表記・発行情報の文言）を廃し、統計ページと同じダークトーンに統一。タイトルは「MY FLIGHT LOG」。地図の陸地は単一色。フッターのMRZ風装飾は横幅いっぱいに敷き、右端は「FLIGHT-LOG」。

v0.13からの変更: Phase 4（埋め込みカード `/embed/stats.html`）を実装。§3.4に実装詳細を追記。

v0.12からの変更: 統計ページの表示文言を**すべて英語**に統一（Distance / Flight Time / Flights / Airports / Airlines / Countries & Territories、Excl./Incl. layovers等）。数値・日付の書式もen-US。

v0.11からの変更: 空港ドットのホバー判定を拡大し、**ホバー中は自動回転を一時停止**（回転でホバーが外れるのを防止）。ツールチップはルート色の文字＋カード背景色でスタイリング。

v0.10からの変更: 空港のスリーレターは**常時表示せず、空港ドットへのホバー時のみ表示**（発着数はツールチップに含めない）。

v0.9からの変更: 地球儀上に、発着いずれか1件でも記録のある空港ごとにIATAスリーレターのラベルを常時表示（v0.11でホバー時のみに変更）。

v0.8からの変更: Phase 3（地球儀ビュー）を実装。§3.3に実装詳細を追記。

v0.7からの変更: 統計ページのレイアウトを確定。1段目=総移動距離・総飛行時間（2カード）、2段目=Flights（通算＋年別テーブル）・Airports・Airlines（3カード）、最下部=行った国。単独の「合計フライト数」カードは廃止しFlightsカードに統合。

v0.6からの変更: 空港カウントの集約ルールを修正。「閾値内の接続を集約」ではなく**「同一空港・同一ローカル日付のタッチを1カウント」**に（Flightyの実測値 BKK=11・KIX=11 の両立から逆推定。日跨ぎの接続は2カウントされる）。

v0.5からの変更: 総飛行時間を**ゲート間（ブロックタイム）基準**に変更（Flightyと同基準）。Top Airports/Top AirlinesをAirports/Airlinesに改め、**合計空港数・合計航空会社数**を表示してその下にランキングを配置。

v0.4からの変更: 統計に**総飛行時間（Flight Time）**と**Top Airports / Top Airlines**を追加。空港マスタにtz database名を追加（ローカル時刻のUTC換算用）。

v0.3からの変更: **未来の便（出発日が集計日より後）をすべての統計から除外**（Flightyの表示と同じ基準。予定便はflights.jsonに保持し、出発日到来後の再ビルドで自動的に算入される）。

v0.2からの変更: 統計項目から「最も多く行った国」（居住国が最多になるのは自明）と「地球◯周」を削除。「行った国」は数字の下に国旗一覧を表示し、統計ページの最下部に配置。

v0.1からの変更: §6の未確定事項をすべて確定し、アーキテクチャを案B'（GitHub Pages + GitHub Actions）に決定。Flighty CSVインポートをPhase 1に追加。

## 1. コンセプト

Flightyのようなリアルタイムトラッカーではなく、**「ログ＋統計＋地球儀ビジュアライズ」に特化した個人フライトログ**のWebアプリケーション。遅延通知・搭乗リマインド・機材詳細などのリッチ機能は持たない。統計カードを外部Webページ（Ghostブログ想定）へ埋め込める仕組みを最終フェーズで提供する。

## 2. 確定した設計判断

| 論点 | 決定 |
|---|---|
| 国のカウント対象 | **出発・到着の両方**の空港の所在国をカウント |
| 乗り継ぎの扱い | **「乗り継ぎ含む」「乗り継ぎ除く」の両方のカウントを表示** |
| 年の基準 | **出発地ローカルの出発日**（Flighty等の既存アプリの標準に準拠。Flightyは出発空港・到着空港・出発日を必須3フィールドとし、出発日をフライトの正準日付として扱う） |
| 往復の扱い | 特記なし。往路・復路で2フライトとして単純カウント |
| アーキテクチャ | **案B': GitHub Pages + GitHub Actions**（§5） |
| 初期移行 | **Flighty CSVエクスポートをインポート**（Settings → Account Data → Export Your Flights） |
| 公開範囲 | 完全公開。アクセス制御は必要になったら後付けで検討 |

## 3. 機能要件

### 3.1 フライト登録

- 入力は**フライトナンバー＋出発日**のみ。航空会社・出発/到着空港・スケジュール時刻は**AeroDataBox API**で自動解決
- 解決結果は登録時に `flights.json` へ保存し、**表示・集計ではAPIを一切呼ばない**
- APIで解決できない古い便のための**手入力フォールバック**（便名・空港ペア・日付）
- **Flighty CSVインポーター**: エクスポートCSVを一括変換して初期データを生成

**Flighty CSVインポート仕様**（実CSVのヘッダー確認済み）:

| Flightyカラム | 変換先 | 備考 |
|---|---|---|
| `Date` | `flight_date` | 出発地ローカルの出発日。本仕様の正準日付とそのまま一致 |
| `Airline` | `airline_code` / `airline_name` | **ICAOコード**（例: TZP=ZIPAIR）。OpenFlights airlinesデータでICAO→IATA・名称に解決 |
| `Flight` | `flight_number` | IATAコード＋便番号に整形（例: ZG51） |
| `From` / `To` | `origin_iata` / `destination_iata` | IATAコードそのまま |
| `Canceled` | `canceled` フラグ | trueの便は保持するが**統計から除外** |
| `Diverted To` | 実効到着地 | 値がある場合、距離・国カウントは`To`ではなくこちらを使用 |
| `Flight Flighty ID` | `id` | 一意ID。再インポート時の重複防止キー |
| `Dep/Arr Terminal`, `Dep/Arr Gate` | `ops.dep_terminal` 等 | 任意項目。AeroDataBoxでも取得可能なため正準モデルに含める |
| `Aircraft Type Name` / `Tail Number` | `ops.aircraft_type` / `ops.tail_number` | 同上 |
| 実離着陸・ゲート発着の実時刻各種 | `ops.*`（下記データモデル参照） | 同上（AeroDataBoxではADS-B由来のベストエフォート） |
| PNR、座席、座席タイプ、キャビンクラス、搭乗理由、メモ、各種Flighty ID | **破棄** | 個人記録系フィールド。APIに存在せず、保存もしない（`Flight Flighty ID`のみ重複防止キーとして`id`に流用） |

**保存方針**: 正準モデル（`flights.json`）に取り込むのは「AeroDataBoxのフライトステータスAPIで扱える項目」までとし、元CSVのアーカイブ保存は行わない。運航データ項目（ターミナル・ゲート・機材・実時刻）は任意の`ops`オブジェクトとして持ち、Flightyインポート時はCSVから、新規登録時はAeroDataBoxレスポンスから同じスキーマで埋める。これにより新旧フライトのデータ構造が統一され、将来の機能追加（総飛行時間、機材別統計等）にも両者同等に対応できる。

- 時刻カラム（Gate Departure等）はTZオフセットなしのローカル表記のため、ナイーブ文字列のまま`scheduled_departure/arrival`に保存（統計には未使用。必要時に空港マスタのTZから復元可能）
- `distance_km`はインポート時にairports.jsonの座標からHaversineで計算して保存
- 登録済みフライトの編集・削除は `flights.json` の直接編集（またはCLI）で行う

### 3.2 統計（表示項目）

| 項目 | 定義 |
|---|---|
| 合計フライト数（Flights） | 通算＋年別内訳（年＝出発地ローカル出発日の年）。Flightsカードの見出し直下に通算、その下に年別テーブル |
| 移動距離 | 全フライトの大圏距離合計（km）。Haversineでローカル計算 |
| 総飛行時間 | 全フライトの**予定ブロックタイム**合計（v0.17で実測ベースから変更。§0参照）。`◯◯h◯◯m` 表示＋その下に小さくDays/Weeks/Months/Years換算を並記。便ごとの時間は公表スケジュール（`scheduled_departure`→`scheduled_arrival`）から、空港マスタのtz database名でローカル時刻をUTC換算して算出 |
| Airports | **合計空港数**＋発着回数ランキング上位5件。出発・実効到着をそれぞれ1タッチとし、**同一空港・同一ローカル日付のタッチは1カウントに集約**（Flightyと同基準。同日乗り継ぎは1、日跨ぎ滞在・接続は2。出発タッチの日付=`flight_date`、到着タッチの日付=到着時刻の日付） |
| Airlines | **合計航空会社数**＋搭乗便数ランキング上位5件 |
| 行った国 | 出発・到着空港の所在国のユニーク数。**乗り継ぎ含む／除くの2値を並記**し、数字の下に国旗を並べて表示。統計ページの最下部に配置 |

**集計対象**: `canceled: true` の便に加え、**未来の便（`flight_date` が集計日より後）もすべての統計から除外**する。予定便として先に登録してもレコードは保持され、出発日を過ぎた後の再ビルド（次のコミット時）で自動的に集計へ算入される。境界は「出発日当日から搭乗済み扱い」とする（集計はデプロイ時にUTCで実行されるが、数時間のズレは次回ビルドで自己解消するため許容）。

**乗り継ぎの判定ロジック**: フライトNの到着空港 ＝ フライトN+1の出発空港（**空港コードの厳密一致**）、かつ両便の間隔が閾値（デフォルト24時間）以内の場合、その中間空港の国を「乗り継ぎ」とみなす。自動判定を基本とし、フライトごとに `layover: true/false` の手動オーバーライドを可能にする（例: 経由地で数日滞在した場合は訪問扱いに変更できる）。

**同一都市・別空港の乗り継ぎ（SAW→IST、DMK→BKK等）**: 空港コードが一致しないため自動判定では乗り継ぎに**該当せず、訪問（行った国）としてカウントされる**。別空港への地上移動は入国を伴うため、これは意図した挙動である（空港厳密一致ルールが「入国の有無」の近似として機能する）。同一都市判定への拡張は行わない。

**既知のエッジケース**: 同一空港乗り継ぎでも入国審査が発生する国（米国等）では、自動判定は「乗り継ぎ」となるがパスポート上は入国している。入国ベースで訪問扱いにしたい場合は `layover: false` の手動オーバーライドで対応する。

### 3.3 地球儀ビュー

- 全ルートを3D地球儀上に大圏アークで描画、ドラッグ/タッチで回転
- 実装は **globe.gl（Three.jsベース）** 第一候補。静的サイトに読み込むだけで動作し、GitHub Pagesと相性が良い
- 描画は保存済みの空港座標のみを使用（API非依存・オフライン動作）

**実装詳細（v0.9で確定）**:
- globe.glのバンドルと国境GeoJSON（Natural Earth 110m）は `site/vendor/` に**同梱**（CDN・外部リソース不使用でオフライン動作）
- 陸地はテクスチャ画像ではなく**六角形ポリゴン**表現（サイトのデザイントーンと統一）
- 描画データは `stats.json` の `globe` フィールド: 空港座標を焼き込んだ無向集約ルート（`from/to/count`）と空港ポイント（発着数でサイズ可変、ホバーでIATA表示）。統計と同じ集計対象（キャンセル・未来便除外、ダイバートは実効到着地）
- 統計ページ最上部に全幅カードで配置。自動回転＋ドラッグ/タッチ操作、アーク太さは搭乗回数で可変
- 発着記録のある空港はドット表示（発着数でサイズ可変）。**ドットへのホバーでIATAスリーレターのみをツールチップ表示**（常時ラベルなし、発着数なし）。ホバー中は自動回転を一時停止。ツールチップはルート色の文字＋カード背景色

### 3.4 埋め込みカード（Phase 4）

- 統計項目のみのカード（地球儀なし）を**iframe埋め込み**用に提供
- 実装: 埋め込み専用の軽量HTMLページ（`/embed/stats.html`）をGitHub Pages上に置き、GhostのHTMLカードから `<iframe src="...">` で参照
- データは同一サイト内の集計済みJSON（`stats.json`、ビルド時に生成）を読むだけ。CORS問題なし

**実装詳細（v0.15で確定）**: 統計ページと同一のダークトーンによるオリジナルデザイン
- ヘッダー: 「MY FLIGHT LOG」（グラデーション文字）＋「PERSONAL FLIGHT STATS」
- 2Dワールドマップ（等長方形図法をcanvas描画。陸地は同梱GeoJSONを**単一色**で塗り、ルートは大圏をslerp近似したシアンの曲線、空港はブルーのドット）＋訪問国の円形国旗バッジ列
- 下段: 便数（グラデーション大文字）・Home base（最多発着空港）/ First flight（初フライト日=`first_flight_date`）/ Updated（集計日）・統計4項目（Distance / Flight Time（`◯d ◯h`表記）/ Airports / Airlines）
- フッター: MRZ風装飾2行を**横幅いっぱい**に表示（`<`の充填をflexでクリップ）。2行目の右端は「FLIGHT-LOG」
- ページ背景は透過、カード最大幅640px。埋め込み例:
  `<iframe src="https://yuta-884.github.io/flight-log/embed/stats.html" width="100%" height="800" style="border:none;max-width:660px" loading="lazy"></iframe>`

## 4. アーキテクチャ（案B': GitHub Pages + Actions）

```
GitHubリポジトリ
├── data/
│   ├── flights.json        # フライトの正準データ
│   └── airports.json       # OpenFlights由来の空港マスタ（IATA→座標・国）
├── scripts/
│   ├── add_flight.js       # 便名+日付 → AeroDataBox解決 → flights.json追記
│   ├── import_flighty.js   # Flighty CSV → flights.json変換
│   └── build_stats.js      # flights.json → stats.json（集計済み）生成
├── site/                   # 静的サイト（地球儀・統計・埋め込みカード）
└── .github/workflows/
    ├── add-flight.yml      # workflow_dispatch: 便名+日付を入力して実行
    └── deploy.yml          # main更新でstats生成+Pagesデプロイ
```

**登録フロー（スマホ運用）**: GitHubモバイルアプリ → Actions → add-flight → Run workflow → 便名と日付を入力 → 実行。ActionがAeroDataBoxを叩き、解決結果をコミット。Pagesが自動再ビルドされ、数分後にサイトへ反映。

**特徴**
- ホスティングコスト: **ゼロ**（GitHub Pages無料枠）
- 外部サービス: AeroDataBoxのみ（APIキーはリポジトリSecrets、月数便の登録なら無料〜最安プラン内）
- 認証: 不要（登録＝リポジトリへのコミット権限そのものが認証）
- データ所有: `flights.json` がそのままエクスポート形式。Gitの履歴が監査ログを兼ねる

**トレードオフ（許容済み）**
- 登録からサイト反映まで数分のビルドラグがある
- 編集・削除はJSON直接編集（頻度が低い操作なので許容）

## 5. データモデル

```jsonc
// flights.json の1レコード
{
  "id": "4b27f0a9-...",                 // Flighty便はFlighty ID、API/手動便は "YYYY-MM-DD-便名"
  "flight_number": "ZG51",              // IATA表記に正規化
  "flight_date": "2022-07-15",          // 出発地ローカルの出発日（正準日付）
  "airline_code": "ZG",                 // IATA（インポート時にICAO→IATA解決）
  "airline_name": "ZIPAIR Tokyo",
  "origin_iata": "NRT",
  "destination_iata": "BKK",
  "diverted_to_iata": null,             // 値がある場合、距離・国カウントの実効到着地
  "canceled": false,                    // trueの便は統計から除外
  "scheduled_departure": "2022-07-15T17:05",  // ローカル時刻（TZオフバージョンはソースに依存）
  "scheduled_arrival": "2022-07-15T21:45",
  "distance_km": 4611,                  // 登録時にHaversineで計算・保存
  "layover": null,                      // null=自動判定 / true / false で手動上書き
  "source": "flighty_import",           // "api" | "manual" | "flighty_import"
  "ops": {                              // 任意。AeroDataBoxで扱える運航データのみ
    "dep_terminal": "1N",
    "dep_gate": "23",
    "arr_terminal": null,
    "arr_gate": null,
    "aircraft_type": "Boeing 787-8",
    "tail_number": "JA825J",
    "actual_gate_departure": "2022-07-15T17:04",
    "actual_takeoff": "2022-07-15T17:21",
    "actual_landing": "2022-07-15T21:11",
    "actual_gate_arrival": "2022-07-15T21:21"
  }
}
```

- `ops`は任意オブジェクト。Flightyインポート時はCSVから、API登録時はAeroDataBoxレスポンス（terminal/gate/aircraft/runwayTime等）から埋める。取得できなかったフィールドはnullまたは省略
- 現行の統計機能は`ops`を参照しない。将来の機能（総飛行時間、機材別統計等）のための拡張領域

- `airports.json`: iata, name, city, country_code, country_name, lat, lon, tz（OpenFlightsから生成、リポジトリに同梱。tzはtz database名で総飛行時間の計算に使用）
- `stats.json`: ビルド時に `build_stats.js` が生成する集計済みデータ。サイトと埋め込みカードはこれだけを読む

## 6. フェーズ分け

| フェーズ | 内容 | 完了条件 |
|---|---|---|
| Phase 1 | データモデル、`add_flight.js`（API解決）、`import_flighty.js`、workflow_dispatch登録 | Flighty CSVが取り込め、スマホから新規便を登録できる |
| Phase 2 | `build_stats.js` と統計ページ（5項目、通算・年別、乗り継ぎ含む/除く） | 全統計が正しく集計・表示される |
| Phase 3 | 地球儀ビュー（globe.gl） | 全ルートがアーク表示され、回転操作できる |
| Phase 4 | 埋め込みカード（`/embed/stats.html`） | GhostのHTMLカードにiframeで統計カードが表示される |

## 7. 残タスク（実装前の準備）

1. FlightyからCSVをエクスポートし、カラム構成を確認（インポーターの入力仕様確定のため）
2. AeroDataBoxのAPIキー取得: **RapidAPI経由のBASICプラン（恒久無料、月600ユニット、過去365日の履歴照会可）**をサブスクライブし、`X-RapidAPI-Key`をリポジトリSecrets（`AERODATABOX_API_KEY`）に登録。API.MarketのBASICは7日トライアルのみのため不採用。将来増枠が必要になった場合のみAPI.Marketの有料プラン（PRO $5〜）への乗り換えを検討
3. GitHubリポジトリ作成（公開設定。Pagesは公開リポジトリなら無料）
