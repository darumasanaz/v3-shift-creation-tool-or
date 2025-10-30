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
TIME_LIMIT=90 PORT=5174 bash run_all.sh
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

## Frontend
Vite + React + TypeScript + Tailwind CSS 構成で、シフト条件の作成と solver 出力の閲覧を行います。

### Config ページ（条件フォーム）
`/config` でシフト条件を入力し、solver 用の `input.json` を生成できます。

- スタッフの勤務可否・固定休・上限・最大連勤をテーブル形式で編集
- ルール（noEarlyAfterDayAB / 夜勤明け休息日数）の編集
- ローカル保存（localStorage）、保存データの読み込み
- サンプル読込（`solver/sample_input_real.json` をベースにフォームへ反映）
- JSON ダウンロード（入力した people / rules を差し込んだ `input.json`）

### Viewer ページ（出力JSONビューア）
OR-Tools の結果ファイル `solver/output.json` をローカルで読み込み、日付×スタッフのシフト表として確認できます。

### 起動手順
```bash
cd frontend
npm install
npm run dev
```

その後、ブラウザで [http://localhost:5173](http://localhost:5173) を開き、上部ナビゲーションから Viewer / Config を切り替えられます。
Viewer ページでは `solver/output.json` をドラッグ＆ドロップするか「JSONを読み込み」ボタンから選択してください。
Config ページでは条件を入力して「JSONダウンロード」で solver 入力を取得できます。

### サンプル読込の準備
1. 最適化を実行して出力を生成します。
   ```bash
   source .venv/bin/activate
   python solver/solver.py --in solver/sample_input_real.json --out solver/output.json --time_limit 30
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
- `summary.totals` の不足 / 過剰 / 希望休違反をカード表示
- 夜勤シフト（NA / NB / NC）の淡色ハイライト
- CSV ダウンロード（1 行目にヘッダ、UTF-8）
- ドラッグ＆ドロップによる JSON 読み込み

※ フロントエンドは静的ビルドが可能な Vite + React + TypeScript + Tailwind CSS 構成です。
