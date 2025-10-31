# shift-creation-v3-or

OR-Tools (CP-SAT) を使ったシフト作成の最適化コア（v3）。
最小構成：`/solver` に CP-SAT モデル、`/frontend` は既存 UI や連携の置き場。

## Quick Run (one command)
Codespaces ならリポジトリ直下で:
```bash
bash run_all.sh
```

環境変数で調整可:

```bash
TIME_LIMIT=90 PORT=5174 API_PORT=9000 bash run_all.sh
```

Windows ローカル:

```powershell
./run_all.ps1
```

実行後、ブラウザで http://localhost:<PORT> を開き、右上のサンプル読込で表示。

## Quick Start
```bash
python -m venv .venv
# PowerShell
. ./.venv/Scripts/Activate.ps1
pip install -r solver/requirements.txt
python solver/solver.py --in solver/sample_input.json --out solver/output.json
```

## Backend API
`backend/main.py` に FastAPI ベースの solver API を用意しています。`/api/solve` へ `input.json` 相当の JSON を POST すると、`solver/solver.py` を実行して output.json を返却します。標準出力のログは `diagnostics.logOutput` に含まれ、Viewer で確認できます。

開発時は次のコマンドで起動できます（既定ポートは `8000`）。

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

`SOLVER_TIME_LIMIT` 環境変数で solver の制限時間を調整可能です。`run_all.sh` / `run_all.ps1` では `API_PORT` と `SOLVER_TIME_LIMIT` を自動で設定し、フロントエンドから同一オリジンでアクセスできるようにプロキシしています。

## Frontend
Vite + React + TypeScript + Tailwind CSS 構成で、シフト条件の作成と solver 出力の閲覧を行います。

### Config ページ（条件フォーム）
`/config` でシフト条件を入力し、solver 用の `input.json` を生成できます。

- 勤務可シフト・固定休はチェックボックスで選択し、選択済みはチップ表示＆ワンクリックで解除可能
- 週／月の「下限 / 上限」を同じ行で入力（空欄は 0 として扱い、無制限や下限なしに相当）
- 最大連勤・ルール（noEarlyAfterDayAB / 夜勤明け休息日数）の編集
- ローカル保存（localStorage）、保存データの読み込み
- サンプル読込（`solver/sample_input_real.json` をベースにフォームへ反映）
- 「入力JSONをダウンロード（solver用）」ボタンで people / rules / wishOffs を差し込んだ `input.json` を生成
- 「この条件で実行」ボタンで solver API (`/api/solve`) を呼び出し、生成された output.json を Viewer へ自動的に引き渡し

### Viewer ページ（出力JSONビューア）
OR-Tools の結果ファイル `solver/output.json` をローカルで読み込み、日付×スタッフのシフト表として確認できます。
Config ページで生成した `input.json` を読み込んだ場合や Config からの自動遷移では、バックエンドの `/api/solve` を呼び出して solver を実行し、結果とログを即座に表示します。

- summary カードでは不足・過剰に加えて希望休違反（wishOffViolations）を表示
- solver の標準出力ログや診断情報を画面上で確認可能

### WishOffs ページ（希望休管理）
`/wish-offs` で 2025 年 12 月のカレンダーを表示し、スタッフごとの希望休（wish offs）を登録できます。

- Config ページで保存したスタッフ一覧から対象を選択（プルダウン／サイドリスト）
- カレンダーをクリックして希望休 ON/OFF を切り替え、選択済みはチップで一覧表示
- ローカル保存キー: `shift-wishoffs-2025-12`
- JSON ダウンロードで現在の希望休データを保存（`wishOffs` は Config の JSON ダウンロードにも自動で含まれます）
- 現時点では 2025/12 固定（将来拡張予定）

### 起動手順
```bash
cd frontend
npm install
npm run dev
```

別ターミナルで backend を起動していない場合は、上記の FastAPI サーバーを立ち上げてください（デフォルト: `uvicorn backend.main:app --port 8000`）。その後、ブラウザで [http://localhost:5173](http://localhost:5173) を開き、上部ナビゲーションから Viewer / Config / WishOffs を切り替えられます。
Viewer ページでは `solver/output.json` をドラッグ＆ドロップするか「JSONを読み込み」ボタンから選択してください。
Config ページでは条件を入力して「入力JSONをダウンロード（solver用）」で solver 入力を取得できます。
`input.json` を読み込むと `/api/solve` 経由で solver が実行され、得られた出力 JSON とログがそのまま表示されます（本番運用時は output.json を直接読み込ませる運用も可能です）。

### サンプル読込の準備
1. 最適化を実行して出力を生成します。
   ```bash
   source .venv/bin/activate
   python solver/solver.py --in solver/sample_input_real.json --out solver/output.json --time_limit 30
   ```
   週／月下限・希望休を含むテストケースは `solver/sample_input_rules_min.json` を利用できます。
   ```bash
   python solver/solver.py --in solver/sample_input_rules_min.json --out solver/output.json --time_limit 60
   ```
2. フロントエンドから参照できる場所へコピーします。
   ```bash
   cd frontend
   npm run copy:out
   npm run dev
   ```
3. ブラウザで [http://localhost:5173](http://localhost:5173) を開き、右上の「サンプル読込」をクリックすると `public/output.json` が即座に表示されます。

`output.json` が見つからない場合（例: 404 エラー）は `npm run copy:out` を再実行してからリロードしてください。

### 主な機能
- 固定ヘッダ付きのシフト表（横スクロール対応）
- `summary.totals` の不足 / 過剰 / 希望休違反 (wishOffViolations) をカード表示
- 夜勤シフト（NA / NB / NC）の淡色ハイライト
- CSV ダウンロード（1 行目にヘッダ、UTF-8）
- ドラッグ＆ドロップによる JSON 読み込み
- solver API が出力したログの閲覧

※ フロントエンドは静的ビルドが可能な Vite + React + TypeScript + Tailwind CSS 構成です。

### solver の新しい重みと制約
- `weeklyMin` / `monthlyMin` を people に指定すると、各週・月の割当下限がハード制約として適用されます（0 または未指定は制約なし）。
- `wishOffs` は `{スタッフID: [日番号]}` 形式で指定でき、割当時に `w_wish_off_violation` で重み付けしたペナルティが追加されます（未設定時は既定値 20）。
- 既存の `W_requested_off_violation` も引き続きサポートされ、`wishOffs` と併用できます。
- infeasible な場合は `summary.diagnostics` に週／月下限の不足や希望休との衝突状況が出力されます。
