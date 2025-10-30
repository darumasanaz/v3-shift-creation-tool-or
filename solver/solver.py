import json, argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Any
from ortools.sat.python import cp_model

SLOTS = ["0-7", "7-9", "9-15", "16-18", "18-21", "21-23"]
SUMMARY_SLOTS = ["7-9", "9-15", "16-18", "18-21", "21-23", "0-7"]

NEED_TEMPLATE_SLOTS = ["7-9", "9-15", "16-18", "18-24", "0-7"]


def _load_shift_catalog(path: Path) -> List[Dict[str, Any]]:
    try:
        raw = json.load(path.open("r", encoding="utf-8"))
    except FileNotFoundError as error:
        raise InputValidationError(
            "Shift catalog file is missing.",
            code="missing_shift_catalog",
            details={"path": str(path)},
        ) from error
    except json.JSONDecodeError as error:
        raise InputValidationError(
            "Shift catalog could not be parsed.",
            code="invalid_shift_catalog",
            details={"path": str(path), "error": str(error)},
        ) from error

    if not isinstance(raw, list) or not raw:
        raise InputValidationError(
            "Shift catalog must be a non-empty array.",
            code="invalid_shift_catalog",
            details={"path": str(path)},
        )

    catalog = []
    seen = set()
    for entry in raw:
        if not isinstance(entry, dict):
            raise InputValidationError(
                "Shift catalog entries must be objects.",
                code="invalid_shift_catalog_entry",
                details={"path": str(path), "entry": entry},
            )
        code = entry.get("code")
        start = entry.get("start")
        end = entry.get("end")
        name = entry.get("name")
        if not isinstance(code, str) or not code:
            raise InputValidationError(
                "Shift catalog entries must include a non-empty code.",
                code="invalid_shift_catalog_code",
                details={"path": str(path), "entry": entry},
            )
        if code in seen:
            raise InputValidationError(
                "Shift catalog contains duplicate codes.",
                code="duplicate_shift_code",
                details={"path": str(path), "code": code},
            )
        seen.add(code)
        if not isinstance(start, int) or not isinstance(end, int):
            raise InputValidationError(
                "Shift catalog entries must include integer start/end.",
                code="invalid_shift_catalog_hours",
                details={"path": str(path), "code": code},
            )
        catalog.append({"code": code, "name": name or code, "start": start, "end": end})
    return catalog


SHIFT_CATALOG_PATH = Path(__file__).with_name("shifts_catalog.json")
SHIFT_CATALOG = _load_shift_catalog(SHIFT_CATALOG_PATH)
SHIFT_BY_CODE = {entry["code"]: entry for entry in SHIFT_CATALOG}
SHIFT_CODE_LIST = [entry["code"] for entry in SHIFT_CATALOG]
SHIFT_CODES = set(SHIFT_CODE_LIST)


class InputValidationError(Exception):
    def __init__(self, message, code="invalid_input", details=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details or {}


@dataclass
class PreparedDemand:
    days: int
    weekday0: int
    day_types: List[str]
    need_template: Dict[str, Dict[str, int]]
    diagnostics: Dict[str, Any]


def sanitize_day_set(values, day_limit=None):
    if not isinstance(values, (list, tuple, set)):
        return set()
    result = set()
    for value in values:
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            day = int(value)
        else:
            try:
                day = int(value)
            except (TypeError, ValueError):
                continue
        if day < 1:
            continue
        if day_limit is not None and day > day_limit:
            continue
        result.add(day)
    return result


def normalize_limit(value):
    try:
        limit = int(value)
    except (TypeError, ValueError):
        return 0
    if limit < 0:
        return 0
    return limit


def get_weight(weights, keys, default):
    for key in keys:
        value = weights.get(key)
        if isinstance(value, (int, float)):
            return value
    return default


def overlap(start, end, a, b):
    return not (end <= a or b <= start)


def ensure_shift_definitions(data: Dict[str, Any]):
    data_shifts = data.get("shifts")
    if not isinstance(data_shifts, list) or not data_shifts:
        data["shifts"] = list(SHIFT_CATALOG)
        return

    provided_codes = set()
    mismatched = []
    unknown = []
    for entry in data_shifts:
        if not isinstance(entry, dict):
            continue
        code = entry.get("code")
        if not isinstance(code, str):
            continue
        provided_codes.add(code)
        catalog_entry = SHIFT_BY_CODE.get(code)
        if catalog_entry is None:
            unknown.append(code)
            continue
        start = entry.get("start")
        end = entry.get("end")
        if start != catalog_entry["start"] or end != catalog_entry["end"]:
            mismatched.append(
                {
                    "code": code,
                    "expected": {"start": catalog_entry["start"], "end": catalog_entry["end"]},
                    "actual": {"start": start, "end": end},
                }
            )

    missing = sorted(SHIFT_CODES - provided_codes)
    if unknown or mismatched or missing:
        raise InputValidationError(
            "Shift definitions in input.json do not match the solver catalog.",
            code="shift_definition_mismatch",
            details={"unknown": unknown, "mismatched": mismatched, "missing": missing},
        )

    data["shifts"] = [dict(entry) for entry in SHIFT_CATALOG]


def ensure_people_shift_codes(data: Dict[str, Any]):
    invalid_people = []
    people = data.get("people")
    if not isinstance(people, list):
        return

    for index, person in enumerate(people):
        if not isinstance(person, dict):
            continue
        can_work = person.get("canWork")
        if not isinstance(can_work, list):
            continue
        invalid_codes = sorted({code for code in can_work if code not in SHIFT_CODES})
        if invalid_codes:
            pid = person.get("id")
            invalid_people.append(
                {
                    "index": index,
                    "staffId": pid if isinstance(pid, str) else None,
                    "invalidCodes": invalid_codes,
                }
            )

    if invalid_people:
        raise InputValidationError(
            "Some people reference unknown shift codes.",
            code="unknown_shift_code",
            details={"invalidPeople": invalid_people},
        )


def should_flag_summary_inconsistency(total_need: Any, total_assigned: Any, shortage_total: Any) -> bool:
    try:
        total_need_int = int(total_need)
    except (TypeError, ValueError):
        return False
    try:
        total_assigned_int = int(total_assigned)
    except (TypeError, ValueError):
        return False
    try:
        shortage_int = int(shortage_total)
    except (TypeError, ValueError):
        shortage_int = 0
    if total_need_int <= 0:
        return False
    return total_assigned_int < total_need_int and shortage_int == 0


def compute_slot_availability(data: Dict[str, Any]) -> Dict[int, Dict[str, int]]:
    days = data.get("days")
    if not isinstance(days, int) or days <= 0:
        return {}
    weekday0 = data.get("weekdayOfDay1", 0)
    staff = data.get("people", [])
    shifts = data.get("shifts", [])

    fixed_map = {
        "Sun": 0,
        "Mon": 1,
        "Tue": 2,
        "Wed": 3,
        "Thu": 4,
        "Fri": 5,
        "Sat": 6,
        "日": 0,
        "月": 1,
        "火": 2,
        "水": 3,
        "木": 4,
        "金": 5,
        "土": 6,
    }

    def weekday_of(d: int) -> int:
        return (weekday0 + (d - 1)) % 7

    availability: Dict[int, Dict[str, int]] = {}
    shift_entries = [entry for entry in shifts if isinstance(entry, dict) and entry.get("code") in SHIFT_CODES]

    for d in range(1, days + 1):
        slots = {}
        wd = weekday_of(d)
        for slot in SUMMARY_SLOTS:
            count = 0
            for person in staff:
                if not isinstance(person, dict):
                    continue
                can_work = person.get("canWork", [])
                if not isinstance(can_work, list):
                    continue
                can_codes = {code for code in can_work if code in SHIFT_CODES}
                if not can_codes:
                    continue
                offs = person.get("fixedOffWeekdays", [])
                if isinstance(offs, list):
                    off_indices = {fixed_map.get(value, value) for value in offs}
                else:
                    off_indices = set()
                try:
                    off_indices = {int(value) for value in off_indices if isinstance(value, (int, str))}
                except ValueError:
                    off_indices = {int(value) for value in off_indices if isinstance(value, int)}
                if wd in off_indices:
                    continue
                unavailable_days = sanitize_day_set(person.get("unavailableDates", []), days)
                if d in unavailable_days:
                    continue
                if not any(
                    shift.get("code") in can_codes and slot_contributes(shift, slot)
                    for shift in shift_entries
                ):
                    continue
                count += 1
            slots[slot] = count
        availability[d] = slots
    return availability


def _as_non_negative_int(value, *, default=0):
    try:
        ivalue = int(value)
    except (TypeError, ValueError):
        return default
    if ivalue < 0:
        return default
    return ivalue


def _ensure_previous_month_carry(data):
    raw = data.get("previousMonthNightCarry")
    if not isinstance(raw, dict):
        raw = {}
    sanitized = {}
    for key in ("NA", "NB", "NC"):
        values = raw.get(key, [])
        if isinstance(values, list):
            sanitized[key] = values
        else:
            sanitized[key] = []
    data["previousMonthNightCarry"] = sanitized
    return sanitized


def _prepare_day_type_list(raw_day_types, days):
    if isinstance(raw_day_types, list):
        if len(raw_day_types) != days:
            raise InputValidationError(
                "dayTypeByDate length does not match days.",
                code="invalid_day_type_length",
                details={"expected": days, "actual": len(raw_day_types)},
            )
        result = []
        for index, value in enumerate(raw_day_types, start=1):
            if not isinstance(value, str) or not value:
                raise InputValidationError(
                    "dayTypeByDate must contain non-empty strings.",
                    code="invalid_day_type_value",
                    details={"day": index, "value": value},
                )
            result.append(value)
        return result

    if isinstance(raw_day_types, dict):
        result = []
        missing = []
        for day in range(1, days + 1):
            value = None
            if day in raw_day_types:
                value = raw_day_types[day]
            elif str(day) in raw_day_types:
                value = raw_day_types[str(day)]
            if value is None:
                missing.append(day)
                continue
            if not isinstance(value, str) or not value:
                raise InputValidationError(
                    "dayTypeByDate must contain non-empty strings.",
                    code="invalid_day_type_value",
                    details={"day": day, "value": value},
                )
            result.append(value)
        if missing:
            raise InputValidationError(
                "dayTypeByDate is missing entries.",
                code="missing_day_type",
                details={"missingDays": missing},
            )
        return result

    raise InputValidationError(
        "dayTypeByDate must be an array or object.",
        code="invalid_day_type",
    )


def _sanitize_need_template(raw_template):
    if not isinstance(raw_template, dict) or not raw_template:
        raise InputValidationError(
            "needTemplate must be a non-empty object.",
            code="invalid_need_template",
        )

    sanitized = {}
    for day_type, raw_slots in raw_template.items():
        if not isinstance(day_type, str) or not day_type:
            raise InputValidationError(
                "needTemplate keys must be strings.",
                code="invalid_need_template_key",
                details={"key": day_type},
            )
        if not isinstance(raw_slots, dict):
            raise InputValidationError(
                "Each needTemplate entry must be an object of slot requirements.",
                code="invalid_need_template_slots",
                details={"dayType": day_type},
            )
        slots = {}
        for slot in NEED_TEMPLATE_SLOTS:
            value = raw_slots.get(slot, 0)
            ivalue = _as_non_negative_int(value)
            slots[slot] = ivalue
        sanitized[day_type] = slots
    return sanitized


def prepare_demand(data):
    days = data.get("days")
    if not isinstance(days, int) or days <= 0:
        raise InputValidationError(
            "days must be a positive integer.",
            code="invalid_days",
            details={"days": days},
        )

    weekday0 = data.get("weekdayOfDay1")
    if not isinstance(weekday0, int) or not (0 <= weekday0 <= 6):
        raise InputValidationError(
            "weekdayOfDay1 must be an integer between 0 and 6.",
            code="invalid_weekday_of_day1",
            details={"weekdayOfDay1": weekday0},
        )

    day_types = _prepare_day_type_list(data.get("dayTypeByDate"), days)
    need_template = _sanitize_need_template(data.get("needTemplate"))

    for day, day_type in enumerate(day_types, start=1):
        if day_type not in need_template:
            raise InputValidationError(
                "dayTypeByDate references unknown day type.",
                code="unknown_day_type",
                details={"day": day, "dayType": day_type},
            )

    previous_carry = _ensure_previous_month_carry(data)
    carry = 0
    if days >= 1:
        carry = sum(len(previous_carry.get(key, [])) for key in ("NA", "NB", "NC"))

    per_day = []
    total_need = 0
    for day_index, day_type in enumerate(day_types, start=1):
        slots = need_template[day_type]
        day_summary = {
            "date": day_index,
            "slots": {
                "7-9": slots["7-9"],
                "9-15": slots["9-15"],
                "16-18": slots["16-18"],
            },
        }
        evening_need = slots["18-24"] or 0
        midnight_need = slots["0-7"] or 0
        carry_today = carry if day_index == 1 else 0
        effective_midnight = max(0, midnight_need - carry_today)
        day_summary["slots"].update({"18-21": evening_need, "21-23": evening_need, "0-7": effective_midnight})
        day_summary["total"] = sum(day_summary["slots"].values())
        day_summary["carryApplied"] = bool(carry_today and midnight_need)
        per_day.append(day_summary)
        total_need += day_summary["total"]

    diagnostics = {
        "days": days,
        "weekdayOfDay1": weekday0,
        "dayTypeSample": day_types[: min(7, len(day_types))],
        "perDayTotals": per_day,
        "totalNeed": total_need,
    }

    if total_need == 0:
        raise InputValidationError(
            "Total demand is zero. All staff will remain off-duty.",
            code="total_need_zero",
            details={"demandDiagnostics": diagnostics},
        )

    diagnostics.setdefault("warnings", [])
    return PreparedDemand(days, weekday0, day_types, need_template, diagnostics)


def log_demand_diagnostics(diagnostics):
    if not isinstance(diagnostics, dict):
        return
    days = diagnostics.get("days")
    weekday0 = diagnostics.get("weekdayOfDay1")
    print(f"[demand] days={days} weekdayOfDay1={weekday0}")
    sample = diagnostics.get("dayTypeSample") or []
    if sample:
        print(f"[demand] dayType sample={sample}")
    per_day = diagnostics.get("perDayTotals") or []
    for entry in per_day[: min(5, len(per_day))]:
        slots = entry.get("slots", {})
        ordered = {slot: slots.get(slot) for slot in ["7-9", "9-15", "16-18", "18-21", "21-23", "0-7"]}
        print(f"[demand] day {entry.get('date')} total={entry.get('total')} slots={ordered}")
    print(f"[demand] totalNeed={diagnostics.get('totalNeed')}")


def build_validation_error_output(data, error: InputValidationError):
    people = data.get("people")
    if not isinstance(people, list):
        people = []
    ids = []
    for person in people:
        pid = None
        if isinstance(person, dict):
            pid = person.get("id")
        if isinstance(pid, str):
            ids.append(pid)

    summary = {
        "shortage": [],
        "overstaff": [],
        "totals": {
            "shortage": 0,
            "overstaff": 0,
            "wishOffViolations": 0,
            "requestedOffViolations": 0,
            "violatedPreferences": 0,
        },
        "diagnostics": {},
    }

    details = error.details if isinstance(error.details, dict) else {}

    diagnostics = details.get("demandDiagnostics")
    if diagnostics:
        diagnostics = dict(diagnostics)
        warnings = list(diagnostics.get("warnings", []))
        if error.code == "total_need_zero":
            warnings.append(
                "総需要が0です。需要テンプレートや曜日設定を確認してください。"
            )
        diagnostics["warnings"] = warnings
        summary["diagnostics"]["demand"] = diagnostics
        log_demand_diagnostics(diagnostics)

    output = {
        "assignments": [],
        "peopleOrder": ids,
        "matrix": [],
        "summary": summary,
        "error": {
            "code": error.code,
            "message": error.message,
            "details": details,
        },
    }

    solver_diagnostics = details.get("solverDiagnostics")
    if isinstance(solver_diagnostics, dict):
        output.setdefault("diagnostics", {}).update(solver_diagnostics)

    return output

def parse_slot(slot_label):
    a, b = map(int, slot_label.split("-"))
    if slot_label == "0-7":
        a += 24
    if b <= a:
        b += 24
    return a, b


def slot_contributes(shift, slot_label):
    a, b = parse_slot(slot_label)
    shift_start, shift_end = shift["start"], shift["end"]
    if shift_end <= shift_start and shift_end <= 24:
        shift_end += 24
    return overlap(shift_start, shift_end, a, b)


def split_weeks(days, weekday0):
    weeks = []
    start = 1
    for d in range(1, days + 1):
        wd = (weekday0 + (d - 1)) % 7
        if wd == 0 and d != 1:
            weeks.append((start, d - 1))
            start = d
    weeks.append((start, days))
    return weeks


def compute_summary(data, assignments, s_values):
    summary = {
        "shortage": [],
        "overstaff": [],
        "totals": {
            "shortage": 0,
            "overstaff": 0,
            "wishOffViolations": 0,
            "requestedOffViolations": 0,
            "violatedPreferences": 0,
        },
        "diagnostics": {},
    }
    requested_off_map = {}

    wish_offs_raw = data.get("wishOffs", {})
    day_limit = data.get("days")
    if isinstance(wish_offs_raw, dict):
        for staff_id, days in wish_offs_raw.items():
            if isinstance(staff_id, str):
                requested_off_map[staff_id] = sanitize_day_set(days, day_limit)

    for person in data.get("people", []):
        staff_id = person.get("id")
        if not isinstance(staff_id, str):
            continue
        extra = sanitize_day_set(person.get("requestedOffDates", []), day_limit)
        if extra:
            requested_off_map.setdefault(staff_id, set()).update(extra)

    def add_shortage(date, slot, lack):
        summary["shortage"].append({"date": date, "slot": slot, "lack": int(lack)})
        summary["totals"]["shortage"] += int(lack)

    def add_overstaff(date, slot, excess):
        summary["overstaff"].append({"date": date, "slot": slot, "excess": int(excess)})
        summary["totals"]["overstaff"] += int(excess)

    days = data["days"]
    day_types = data["dayTypeByDate"]
    need_template = data["needTemplate"]
    carry = 0
    if days >= 1:
        carry = sum(
            len(data["previousMonthNightCarry"].get(key, [])) for key in ("NA", "NB", "NC")
        )

    for d in range(1, days + 1):
        if d == 1:
            carry_today = carry
        else:
            carry_today = 0
        day_type = day_types[d - 1]
        needs = need_template[day_type]

        for slot in ["7-9", "9-15", "16-18"]:
            actual = s_values.get((d, slot), 0)
            need = needs[slot]
            lack = max(0, need - actual)
            excess = max(0, actual - (need + 1))
            if lack > 0:
                add_shortage(d, slot, lack)
            if excess > 0:
                add_overstaff(d, slot, excess)

        actual = s_values.get((d, "18-21"), 0)
        lack = max(0, 2 - actual)
        excess = max(0, actual - 3)
        if lack > 0:
            add_shortage(d, "18-21", lack)
        if excess > 0:
            add_overstaff(d, "18-21", excess)

        actual = s_values.get((d, "21-23"), 0)
        lack = max(0, 2 - actual)
        excess = max(0, actual - 2)
        if lack > 0:
            add_shortage(d, "21-23", lack)
        if excess > 0:
            add_overstaff(d, "21-23", excess)

        actual = s_values.get((d, "0-7"), 0)
        actual_with_carry = actual + carry_today
        lack = max(0, 2 - actual_with_carry)
        excess = max(0, actual_with_carry - 2)
        if lack > 0:
            add_shortage(d, "0-7", lack)
        if excess > 0:
            add_overstaff(d, "0-7", excess)

    for assignment in assignments:
        staff_id = assignment.get("staffId")
        date = assignment.get("date")
        if date in requested_off_map.get(staff_id, set()):
            summary["totals"]["wishOffViolations"] += 1
            summary["totals"]["requestedOffViolations"] += 1

    summary["totals"]["violatedPreferences"] = summary["totals"]["wishOffViolations"]
    return summary


def estimate_slot_max_possible(data):
    availability = compute_slot_availability(data)
    slot_capacity = {}
    for day, slots in availability.items():
        for slot in SUMMARY_SLOTS:
            slot_capacity[(day, slot)] = slots.get(slot, 0)
    return slot_capacity

def solve(data, time_limit=10.0):
    try:
        ensure_shift_definitions(data)
        ensure_people_shift_codes(data)
        prepared = prepare_demand(data)
    except InputValidationError as error:
        return build_validation_error_output(data, error)

    log_demand_diagnostics(prepared.diagnostics)

    data["days"] = prepared.days
    data["weekdayOfDay1"] = prepared.weekday0
    data["dayTypeByDate"] = prepared.day_types
    data["needTemplate"] = prepared.need_template

    days_count = prepared.days
    days = range(1, days_count + 1)
    staff = data["people"]
    shifts = data["shifts"]
    rules = data.get("rules", {})
    I = range(len(staff))
    K = range(len(shifts))

    availability_map = compute_slot_availability(data)
    availability_output = {
        str(day): {slot: int(value) for slot, value in (slots or {}).items()}
        for day, slots in availability_map.items()
    }
    solver_diagnostics: Dict[str, Any] = {"availability": availability_output}
    diagnostics_flags: Dict[str, bool] = {}
    solver_warnings: List[str] = []

    per_day_totals = prepared.diagnostics.get("perDayTotals") or []
    needs_lookup: Dict[int, Dict[str, int]] = {}
    for entry in per_day_totals:
        if not isinstance(entry, dict):
            continue
        day = entry.get("date")
        if not isinstance(day, int):
            continue
        slots = entry.get("slots") or {}
        needs_lookup[day] = {slot: int(slots.get(slot, 0) or 0) for slot in SUMMARY_SLOTS}

    total_need = int(prepared.diagnostics.get("totalNeed", 0) or 0)
    availability_warnings: List[Dict[str, Any]] = []
    all_slots_zero = True
    for day in range(1, days_count + 1):
        slots = availability_map.get(day, {})
        if any(int(slots.get(slot, 0) or 0) > 0 for slot in SUMMARY_SLOTS):
            all_slots_zero = False
        for slot in SUMMARY_SLOTS:
            need = needs_lookup.get(day, {}).get(slot, 0)
            available = int(slots.get(slot, 0) or 0)
            if need > 0 and available == 0:
                availability_warnings.append(
                    {"date": day, "slot": slot, "need": int(need), "available": int(available)}
                )

    if all_slots_zero and total_need > 0:
        details = {
            "solverDiagnostics": {
                **solver_diagnostics,
                "availabilityWarnings": availability_warnings,
            },
            "demandDiagnostics": prepared.diagnostics,
        }
        raise_error = InputValidationError(
            "No staff can be assigned to any slot despite positive demand.",
            code="no_availability",
            details=details,
        )
        return build_validation_error_output(data, raise_error)

    if availability_warnings:
        diagnostics_flags["availability_warning"] = True
        solver_warnings.append(
            "需要があるのに割り当て可能なスタッフが0人のスロットがあります。"
        )
    if diagnostics_flags:
        solver_diagnostics["flags"] = diagnostics_flags
    if solver_warnings:
        solver_diagnostics["warnings"] = solver_warnings
    if availability_warnings:
        solver_diagnostics["availabilityWarnings"] = availability_warnings

    weights = data.get("weights", {})
    if not isinstance(weights, dict):
        weights = {}

    raw_wish_offs = data.get("wishOffs", {})
    sanitized_wish_offs = {}
    if isinstance(raw_wish_offs, dict):
        for staff_id, values in raw_wish_offs.items():
            if isinstance(staff_id, str):
                sanitized_wish_offs[staff_id] = sorted(sanitize_day_set(values, days_count))
    data["wishOffs"] = sanitized_wish_offs

    combined_wish_off_sets = {pid: set(days_list) for pid, days_list in sanitized_wish_offs.items()}
    for person in staff:
        pid = person.get("id")
        if not isinstance(pid, str):
            continue
        extra = sanitize_day_set(person.get("requestedOffDates", []), days_count)
        if extra:
            combined_wish_off_sets.setdefault(pid, set()).update(extra)

    m = cp_model.CpModel()

    # decision vars
    x = {(d,i,k): m.NewBoolVar(f"x_d{d}_i{i}_k{k}") for d in days for i in I for k in K}
    work = {(d,i): m.NewBoolVar(f"work_d{d}_i{i}") for d in days for i in I}

    var_counts = {"x": len(x)}
    solver_diagnostics["var_counts"] = var_counts
    if var_counts["x"] == 0:
        details = {
            "varCounts": var_counts,
            "solverDiagnostics": solver_diagnostics,
            "demandDiagnostics": prepared.diagnostics,
        }
        raise_error = InputValidationError(
            "No assignment variables were created. Staff availability is zero.",
            code="no_assignment_variables",
            details=details,
        )
        return build_validation_error_output(data, raise_error)

    # 1) 1日1勤務 & work定義
    for d in days:
        for i in I:
            m.Add(sum(x[d,i,k] for k in K) <= 1)
            m.Add(work[d,i] == sum(x[d,i,k] for k in K))

    # 2) 個人の可否
    code_index = {shifts[k]["code"]: k for k in K}
    can_cache = []
    for i, p in enumerate(staff):
        can = set(p["canWork"])
        can_cache.append(can)
        for d in days:
            for k in K:
                if shifts[k]["code"] not in can:
                    m.Add(x[d,i,k] == 0)

    # 3) 固定休（曜日インデックス: 0=Sun...6=Sat）
    fixed_map = {"Sun":0,"Mon":1,"Tue":2,"Wed":3,"Thu":4,"Fri":5,"Sat":6,
                 "日":0,"月":1,"火":2,"水":3,"木":4,"金":5,"土":6}
    def weekday_of(d):
        return (data["weekdayOfDay1"] + (d-1)) % 7

    fixed_off_cache = []
    unavailable_cache = []
    for p in staff:
        offs = set(fixed_map.get(w, w) for w in p.get("fixedOffWeekdays", []))
        fixed_off_cache.append(offs)
        unavailable_cache.append(sanitize_day_set(p.get("unavailableDates", []), days_count))

    for d in days:
        wd = weekday_of(d)
        for i in I:
            if wd in fixed_off_cache[i]:
                m.Add(sum(x[d,i,k] for k in K) == 0)

    # 3b) 週上限
    weeks = split_weeks(data["days"], data["weekdayOfDay1"])
    for i, p in enumerate(staff):
        wmax = normalize_limit(p.get("weeklyMax", 0))
        wmin = normalize_limit(p.get("weeklyMin", 0))
        for a, b in weeks:
            week_days = [d for d in range(a, b + 1) if 1 <= d <= days_count]
            if wmax > 0:
                m.Add(sum(work[d, i] for d in week_days) <= wmax)
            if wmin > 0:
                m.Add(sum(work[d, i] for d in week_days) >= wmin)

    # 3c) 月間上限
    for i, p in enumerate(staff):
        mmax = normalize_limit(p.get("monthlyMax", 0))
        mmin = normalize_limit(p.get("monthlyMin", 0))
        if mmax > 0:
            m.Add(sum(work[d, i] for d in days) <= mmax)
        if mmin > 0:
            m.Add(sum(work[d, i] for d in days) >= mmin)

    # 3d) 特定日NG
    for i in I:
        unavailable = unavailable_cache[i]
        for d in days:
            if d in unavailable:
                m.Add(sum(x[d, i, k] for k in K) == 0)

    # 4) 夜勤明け休み
    rest_map = rules.get("nightRest", {})
    for d in days:
        for i in I:
            for code, r in rest_map.items():
                k = code_index.get(code)
                if k is None or r is None:
                    continue
                try:
                    r_int = int(r)
                except (TypeError, ValueError):
                    continue
                if r_int <= 0:
                    continue
                for t in range(1, r_int + 1):
                    next_day = d + t
                    if next_day in days:
                        m.Add(work[next_day, i] == 0).OnlyEnforceIf(x[d, i, k])

    # 5) 最大連勤
    for i, p in enumerate(staff):
        L = normalize_limit(p.get("consecMax", 5))
        if L <= 0:
            continue
        for start in days:
            window = [t for t in range(start, start+L+1) if t in days]
            if len(window) == L+1:
                m.Add(sum(work[t,i] for t in window) <= L)

    # 6) 前日がDA/DB → 翌日EA不可
    if rules.get("noEarlyAfterDayAB", False):
        ida = code_index.get("DA")
        idb = code_index.get("DB")
        iea = code_index.get("EA")
        if ida is not None and idb is not None and iea is not None:
            for d in days:
                if d+1 in days:
                    for i in I:
                        m.Add(x[d,i,ida] + x[d,i,idb] + x[d+1,i,iea] <= 1)

    # スロット供給 s[d,slot]
    bigN = len(I)
    s = {(d,slot): m.NewIntVar(0, bigN, f"s_d{d}_{slot}") for d in days for slot in SLOTS}
    for d in days:
        for slot in SLOTS:
            m.Add(s[d,slot] == sum(
                x[d,i,k] for i in I for k in K if slot_contributes(shifts[k], slot)
            ))

    # 7) 夜間需要（不足はペナルティで吸収）
    penalties = []
    shortage_weight = get_weight(weights, ["w_shortage", "W_shortage"], 1000)
    overstaff_weight = get_weight(weights, ["w_overstaff_gt_need_plus1", "W_overstaff_gt_need_plus1"], 5)
    wish_off_weight_default = get_weight(weights, ["w_wish_off_violation", "W_requested_off_violation"], 20)

    for d in days:
        dayType = data["dayTypeByDate"][d - 1]
        needs = data["needTemplate"][dayType]

        # 21-23 >= need (default 2). allow shortage with penalty
        need_evening = needs.get("18-24", 2)
        lack = m.NewIntVar(0, bigN, f"lack_d{d}_21_23")
        m.Add(s[d, "21-23"] + lack >= need_evening)
        m.Add(s[d, "21-23"] <= need_evening)
        if shortage_weight:
            penalties.append(shortage_weight * lack)

        # 0-7 >= need（d=1はcarry考慮）。allow shortage with penalty
        need_midnight = needs.get("0-7", 2)
        carry = 0
        if d == 1:
            for key in ("NA", "NB", "NC"):
                carry += len(data["previousMonthNightCarry"].get(key, []))
        effective_need = max(0, need_midnight - carry)
        lack_mid = m.NewIntVar(0, bigN, f"lack_d{d}_0_7")
        m.Add(s[d, "0-7"] + lack_mid >= effective_need)
        if d == 1:
            m.Add(s[d, "0-7"] <= effective_need)
        else:
            m.Add(s[d, "0-7"] <= need_midnight)
        if shortage_weight:
            penalties.append(shortage_weight * lack_mid)

        # 18-21 >= need (default 2) and <=3
        need_evening_slot = needs.get("18-24", 2)
        lack_18_21 = m.NewIntVar(0, bigN, f"lack_d{d}_18_21")
        m.Add(s[d, "18-21"] + lack_18_21 >= need_evening_slot)
        m.Add(s[d, "18-21"] <= 3)
        if shortage_weight:
            penalties.append(shortage_weight * lack_18_21)

    # 8) 日中下限 + 9) need+1超の過剰ペナルティ

    for i, p in enumerate(staff):
        pid = p.get("id")
        if not isinstance(pid, str):
            continue
        requested = combined_wish_off_sets.get(pid, set())
        if not requested:
            continue
        personal_weight = p.get("requestedOffWeight")
        weight = wish_off_weight_default
        if isinstance(personal_weight, (int, float)):
            weight = personal_weight
        if weight <= 0:
            continue
        for d in requested:
            if 1 <= d <= days_count:
                penalties.append(weight * work[d, i])

    for d in days:
        dayType = data["dayTypeByDate"][d-1]
        needs = data["needTemplate"][dayType]
        for slot in ["7-9","9-15","16-18"]:
            need = needs[slot]
            lack = m.NewIntVar(0, bigN, f"lack_d{d}_{slot}")
            m.Add(s[d, slot] + lack >= need)
            if shortage_weight:
                penalties.append(shortage_weight * lack)
            ex = m.NewIntVar(0, bigN, f"ex_d{d}_{slot}")
            m.Add(ex >= s[d, slot] - (need + 1))
            m.Add(ex >= 0)
            if overstaff_weight:
                penalties.append(overstaff_weight * ex)

    # 目的関数
    m.Minimize(sum(penalties))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    res = solver.Solve(m)

    out = {"assignments": []}
    if res in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        s_values = {(d, slot): solver.Value(s[d, slot]) for d in days for slot in SLOTS}
        for d in days:
            for i in I:
                for k in K:
                    if solver.Value(x[d,i,k]) == 1:
                        out["assignments"].append({
                            "date": d,
                            "staffId": staff[i]["id"],
                            "shift": shifts[k]["code"]
                        })
        out["summary"] = compute_summary(data, out["assignments"], s_values)
        summary = out["summary"]
        summary.setdefault("diagnostics", {})["demand"] = prepared.diagnostics
        totals = summary.setdefault("totals", {})
        totals["assigned"] = len(out["assignments"])
        totals.setdefault("totalNeed", total_need)

        shortage_total = totals.get("shortage", 0)
        if should_flag_summary_inconsistency(total_need, totals.get("assigned"), shortage_total):
            diagnostics_flags["inconsistent_summary"] = True
            summary.setdefault("diagnostics", {}).setdefault("warnings", []).append(
                "summary.totals.shortage が0ですが、割当が需要を満たしていません。"
            )
            solver_warnings.append(
                "需要があるのに不足=0です。コード不一致や可用性ゼロを確認してください。"
            )
    else:
        out["infeasible"] = True
        slot_caps = estimate_slot_max_possible(data)
        diagnostics = []
        carry = sum(
            len(data["previousMonthNightCarry"].get(key, [])) for key in ("NA", "NB", "NC")
        ) if data["days"] >= 1 else 0
        for d in days:
            day_type = data["dayTypeByDate"][d - 1]
            needs = data["needTemplate"][day_type]
            for slot in SUMMARY_SLOTS:
                if slot in ("7-9", "9-15", "16-18"):
                    need = needs[slot]
                elif slot == "18-21":
                    need = 2
                elif slot == "21-23":
                    need = 2
                else:  # 0-7
                    need = 2
                    if d == 1:
                        need = max(0, need - carry)

                max_possible = slot_caps.get((d, slot), 0)
                if max_possible < need:
                    diagnostics.append({
                        "date": d,
                        "slot": slot,
                        "need": int(need),
                        "maxPossible": int(max_possible),
                    })
        if diagnostics:
            for item in diagnostics:
                print(
                    f"[diagnostic] day {item['date']} slot {item['slot']}: need {item['need']} maxPossible {item['maxPossible']}"
                )
        weekly_diagnostics = []
        monthly_diagnostics = []
        wish_off_conflict_entries = []

        for i, p in enumerate(staff):
            pid = p.get("id")
            if not isinstance(pid, str):
                continue
            wmin = normalize_limit(p.get("weeklyMin", 0))
            wmax = normalize_limit(p.get("weeklyMax", 0))
            mmin = normalize_limit(p.get("monthlyMin", 0))
            mmax = normalize_limit(p.get("monthlyMax", 0))
            if wmax and wmin and wmin > wmax:
                weekly_diagnostics.append(
                    {
                        "type": "weekly_min_exceeds_max",
                        "staffId": pid,
                        "min": int(wmin),
                        "max": int(wmax),
                    }
                )
            if mmax and mmin and mmin > mmax:
                monthly_diagnostics.append(
                    {
                        "type": "monthly_min_exceeds_max",
                        "staffId": pid,
                        "min": int(mmin),
                        "max": int(mmax),
                    }
                )

            wish_set = combined_wish_off_sets.get(pid, set())
            monthly_available = 0
            monthly_available_no_wish = 0

            for a, b in weeks:
                week_days = [d for d in range(a, b + 1) if 1 <= d <= days_count]
                available = 0
                available_no_wish = 0
                for d in week_days:
                    if d in unavailable_cache[i]:
                        continue
                    if weekday_of(d) in fixed_off_cache[i]:
                        continue
                    if not can_cache[i]:
                        continue
                    available += 1
                    if d not in wish_set:
                        available_no_wish += 1
                monthly_available += available
                monthly_available_no_wish += available_no_wish
                if wmin and available < wmin:
                    weekly_diagnostics.append(
                        {
                            "type": "weekly_min_shortage",
                            "staffId": pid,
                            "weekStart": a,
                            "weekEnd": b,
                            "min": int(wmin),
                            "available": int(available),
                        }
                    )
                if wmin and available_no_wish < wmin:
                    missing = max(0, wmin - available_no_wish)
                    wish_off_conflict_entries.append(
                        {
                            "scope": "weekly",
                            "staffId": pid,
                            "weekStart": a,
                            "weekEnd": b,
                            "min": int(wmin),
                            "availableExcludingWishOff": int(available_no_wish),
                            "missing": int(missing),
                        }
                    )

            if mmin and monthly_available < mmin:
                monthly_diagnostics.append(
                    {
                        "type": "monthly_min_shortage",
                        "staffId": pid,
                        "min": int(mmin),
                        "available": int(monthly_available),
                    }
                )
            if mmin and monthly_available_no_wish < mmin:
                missing = max(0, mmin - monthly_available_no_wish)
                wish_off_conflict_entries.append(
                    {
                        "scope": "monthly",
                        "staffId": pid,
                        "min": int(mmin),
                        "availableExcludingWishOff": int(monthly_available_no_wish),
                        "missing": int(missing),
                    }
                )

        wish_off_conflict_count = int(
            sum(max(0, entry.get("missing", 0)) for entry in wish_off_conflict_entries)
        )

        out.setdefault("diagnostics", {})["unmetCandidates"] = diagnostics
        summary = out.setdefault(
            "summary",
            {
                "shortage": [],
                "overstaff": [],
                "totals": {
                    "shortage": 0,
                    "overstaff": 0,
                    "wishOffViolations": 0,
                    "requestedOffViolations": 0,
                    "violatedPreferences": 0,
                },
                "diagnostics": {},
            },
        )
        summary.setdefault("diagnostics", {})
        summary["diagnostics"].update(
            {
                "weekly": weekly_diagnostics,
                "monthly": monthly_diagnostics,
                "wishOffConflicts": wish_off_conflict_entries,
                "wishOffConflictCount": wish_off_conflict_count,
            }
        )
        summary["diagnostics"]["demand"] = prepared.diagnostics
    ids = [p["id"] for p in staff]
    matrix_rows = []
    for d in days:
        matrix_rows.append({"date": d, "shifts": {pid: "" for pid in ids}})
    for assignment in out["assignments"]:
        date = assignment.get("date")
        pid = assignment.get("staffId")
        shift = assignment.get("shift", "")
        if isinstance(date, int) and 1 <= date <= len(matrix_rows):
            row = matrix_rows[date - 1]["shifts"]
            if pid in row:
                row[pid] = shift
    out["peopleOrder"] = ids
    out["matrix"] = matrix_rows
    if diagnostics_flags:
        solver_diagnostics["flags"] = diagnostics_flags
    if solver_warnings:
        solver_diagnostics["warnings"] = solver_warnings
    if availability_warnings:
        solver_diagnostics["availabilityWarnings"] = availability_warnings
    out.setdefault("diagnostics", {}).update(solver_diagnostics)
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", required=True)
    ap.add_argument("--out", dest="outfile", required=True)
    ap.add_argument("--time_limit", type=float, default=10.0)
    args = ap.parse_args()

    data = json.load(open(args.infile, "r", encoding="utf-8"))
    result = solve(data, time_limit=args.time_limit)
    json.dump(result, open(args.outfile, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"wrote {args.outfile}")

if __name__ == "__main__":
    main()
