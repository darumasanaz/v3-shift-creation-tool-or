# shift-creation-v3-or

OR-Tools (CP-SAT) を使ったシフト作成の最適化コア（v3）。
最小構成: `/solver` に CP-SAT モデル、`/frontend` はシフト条件の編集と結果ビューアです。

## Quick Run (one command)
Codespaces / ローカルのどちらでも、リポジトリ直下で次を実行すると Vite の開発サーバーが立ち上がります。

```bash
bash run_all.sh
```

Windows PowerShell:

```powershell
./run_all.ps1
```

起動が完了するとポート 5173 で Viewer / Config / WishOffs を切り替えられます。

## Quick Start (manual)
開発コマンドを直接使う場合は下記の順序でセットアップしてください。

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: . ./.venv/Scripts/Activate.ps1
pip install -r solver/requirements.txt
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --strictPort --port 5173
```

ビルドとプレビュー:

```bash
npm run build
npm run preview -- --port 5173
```

## 開発フロー（solver との連携）
Vite の開発サーバーには `/api/solve` と `/api/export-xlsx` のエンドポイントが組み込まれています。Config / Viewer から solver 実行を指示すると、次の順序で処理されます。

1. solver 入力を `solver/input.json` として保存
2. `python solver/solver.py --in solver/input.json --out solver/output.json --time_limit 60` をサブプロセスで実行
3. `solver/output.json` を読み込み、標準出力ログを diagnostics.logOutput に格納
4. 成功時は「solver 実行完了：output.json を表示中」のトーストを表示、失敗時は stderr 先頭 20 行程度をエラーメッセージとして UI に返却

Excel ダウンロードは同様に `/api/export-xlsx` を呼び出し、Python 側で `solver/export_xlsx.py` を実行して生成されたワークブックを返します。

## Viewer / Config / WishOffs

- 共通ヘッダー右上の「作成月」で対象月 (YYYY-MM) を切り替えられます。選択値はブラウザのローカルストレージに保存され、Config / WishOffs / Viewer の計算すべてに反映されます。

### Config ページ（条件フォーム）
- 勤務可シフト・固定休・上限などを入力して solver 用 `input.json` を構築
- サンプル読込（`solver/sample_input_real.json`）で初期データを展開
- 「保存」でローカルストレージへ書き込み、「読み込み」で再利用
- 「入力JSONをダウンロード（solver用）」で生成した JSON を保存可能
- 「この条件で実行」ボタンで solver を実行し、Viewer へ遷移して結果を表示

### Viewer ページ（出力JSONビューア）
- `output.json` をドラッグ＆ドロップまたは選択して表示
- `input.json` を読み込んだ場合は自動で solver を実行し、結果とログを表示
- solver 実行後は成功トーストとともに最新の結果が表示され、ログは画面下部で確認可能
- CSV / Excel ダウンロードに対応（Excel は `/api/export-xlsx` を利用）

### WishOffs ページ（希望休管理）
- 選択月の 1 日〜末日をカレンダー表示し、希望休を登録
- Config で登録したスタッフから対象を選択
- JSON ダウンロード / ローカル保存に対応（保存キーは自動管理）

#### 操作例（2025 年 12 月を生成する場合）
1. ヘッダー右上の月セレクタを `2025-12` に変更
2. Config ページで条件を保存
3. Viewer ページの「この条件で実行」を押す
   - `input.json` に `year=2025`, `month=12`, `days=31`, `weekdayOfDay1=1`, `dayTypeByDate`（土日: normalDay / 水曜: wednesday / それ以外: bathDay）が設定されます

## サンプルデータの利用
サンプルの output.json を即座に確認したい場合は、別ターミナルで次を実行してください。

```bash
cd frontend
npm run copy:out
npm run dev -- --host 0.0.0.0 --strictPort --port 5173
```

`solver/output.json`（または `solver/output_dec2025.json` など）を `frontend/public/output.json` にコピーし、Viewer の「サンプル読込」から表示できます。

## ローカルストレージの自動クリーンアップ
`frontend/src/constants.ts` で `SCHEMA_VERSION` を定義し、アプリ起動時に `v3shift:` プレフィックスの保存値を管理しています。スキーマが変わった場合はバージョンを更新すると古い保存値が自動的に削除され、“全部休” になる症状を防ぎます。

## solver コマンドライン
solver を単体で実行する場合は次のように呼び出せます。

```bash
python solver/solver.py --in solver/sample_input_real.json --out solver/output.json --time_limit 60
```

生成された `solver/output.json` は Viewer から読み込めます。
