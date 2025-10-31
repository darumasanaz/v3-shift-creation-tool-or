from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Dict, Tuple

from flask import Flask, Response, jsonify, request
from flask_cors import CORS

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from solver.export_xlsx import build_default_filename, export_to_xlsx_bytes
from solver.solver import solve_from_dict

app = Flask(__name__)
CORS(app)

REQUIRED_KEYS = [
    "year",
    "month",
    "days",
    "people",
    "shifts",
    "needTemplate",
    "dayTypeByDate",
    "strictNight",
]


def _validate_payload(payload: Dict[str, Any]) -> Tuple[bool, str | None]:
    missing = [key for key in REQUIRED_KEYS if key not in payload]
    if missing:
        return False, f"Missing keys: {', '.join(missing)}"
    return True, None


def _ensure_metadata(output: Dict[str, Any], source: Dict[str, Any]) -> None:
    for key in ("year", "month", "days"):
        if key not in output and key in source:
            output[key] = source[key]
    if output.get("infeasible") and "reason" not in output:
        output["reason"] = "不可解です。条件を緩めて再実行してください。"


@app.get("/api/health")
def health() -> Response:
    return jsonify({"ok": True})


@app.post("/api/solve")
def solve() -> Response:
    try:
        payload = request.get_json(force=True, silent=False)
    except Exception:
        return (
            jsonify({"ok": False, "error": "Request body must be valid JSON."}),
            400,
        )

    if not isinstance(payload, dict):
        return (
            jsonify({"ok": False, "error": "Request body must be a JSON object."}),
            400,
        )

    is_valid, error_message = _validate_payload(payload)
    if not is_valid:
        return jsonify({"ok": False, "error": error_message}), 400

    try:
        result = solve_from_dict(payload)
    except Exception as exc:  # pragma: no cover - defensive logging
        traceback.print_exc()
        return (
            jsonify({"ok": False, "error": f"Solver execution failed: {exc}"}),
            500,
        )

    if not isinstance(result, dict):
        return (
            jsonify({"ok": False, "error": "Solver returned invalid data."}),
            500,
        )

    _ensure_metadata(result, payload)

    return jsonify({"ok": True, "output": result})


@app.post("/api/export-xlsx")
def export_xlsx() -> Response:
    try:
        payload = request.get_json(force=True, silent=False)
    except Exception:
        return (
            jsonify({"ok": False, "error": "Request body must be valid JSON."}),
            400,
        )

    if not isinstance(payload, dict):
        return (
            jsonify({"ok": False, "error": "Request body must be a JSON object."}),
            400,
        )

    try:
        workbook = export_to_xlsx_bytes(payload)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:  # pragma: no cover - defensive logging
        traceback.print_exc()
        return (
            jsonify({"ok": False, "error": f"Excel export failed: {exc}"}),
            500,
        )

    try:
        filename = build_default_filename(payload)
    except Exception:
        filename = "shift-schedule.xlsx"

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
    return Response(workbook, headers=headers)


if __name__ == "__main__":
    port = int(os.environ.get("API_PORT", os.environ.get("PORT", "8001")))
    app.run(host="0.0.0.0", port=port, debug=True)
