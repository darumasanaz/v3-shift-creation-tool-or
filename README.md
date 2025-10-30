# shift-creation-v3-or

OR-Tools (CP-SAT) を使ったシフト作成の最適化コア（v3）。  
最小構成：/solver に CP-SAT モデル、/frontend は既存UIや連携の置き場。

## Quick Start
```bash
python -m venv .venv
# PowerShell
. ./.venv/Scripts/Activate.ps1
pip install -r solver/requirements.txt
python solver/solver.py --in solver/sample_input.json --out solver/output.json


## 4-2) `solver/model_schema.md`
```bash
cat > solver/model_schema.md << 'EOF'
# 入出力スキーマ（概要）

- 入力: `year, month, days, weekdayOfDay1, previousMonthNightCarry, shifts[], needTemplate, dayTypeByDate[], strictNight, people[], rules{}, weights{}`
- 出力: `assignments[]`, `summary.shortage[]`, `summary.overstaff[]`, `infeasible?`

※ 詳細はコード内コメントも参照。
