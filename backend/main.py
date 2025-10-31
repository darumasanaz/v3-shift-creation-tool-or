"""FastAPI backend to expose the OR-Tools solver over HTTP."""
from __future__ import annotations

import contextlib
import io
import logging
import os
from typing import Any, Dict, Tuple

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from solver import solver as solver_module

LOGGER = logging.getLogger("solver_api")
DEFAULT_TIME_LIMIT = float(os.environ.get("SOLVER_TIME_LIMIT", "60"))

app = FastAPI(title="Shift Solver API", version="1.0.0")


def _execute_solver(data: Dict[str, Any], time_limit: float) -> Tuple[Dict[str, Any], str]:
    """Run the solver and capture its stdout logs."""
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        result = solver_module.solve(dict(data), time_limit=time_limit)
    logs = buffer.getvalue()
    if not isinstance(result, dict):
        raise RuntimeError("Solver returned a non-dict response")
    return result, logs


@app.get("/api/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/api/solve")
async def solve_endpoint(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception as exc:  # pragma: no cover - FastAPI wraps JSON errors
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "invalid_json", "message": "Request body must be valid JSON."},
        ) from exc

    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "invalid_payload", "message": "Request body must be a JSON object."},
        )

    time_limit_param = request.query_params.get("time_limit")
    time_limit = DEFAULT_TIME_LIMIT
    if time_limit_param is not None:
        try:
            time_limit = float(time_limit_param)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error": "invalid_time_limit", "message": "time_limit must be numeric."},
            ) from exc
        if time_limit <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error": "invalid_time_limit", "message": "time_limit must be positive."},
            )

    try:
        result, logs = await run_in_threadpool(_execute_solver, payload, time_limit)
    except Exception as exc:  # pragma: no cover - defensive logging
        LOGGER.exception("Solver execution failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "solver_execution_failed", "message": "Solver execution failed."},
        ) from exc

    diagnostics = result.get("diagnostics")
    if isinstance(diagnostics, dict):
        if logs.strip():
            diagnostics["logOutput"] = logs
    else:
        diagnostics = {"logOutput": logs} if logs.strip() else {}
        result["diagnostics"] = diagnostics

    return JSONResponse(content=result)
