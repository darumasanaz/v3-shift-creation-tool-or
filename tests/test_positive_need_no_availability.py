from copy import deepcopy

from solver import solver


def build_base_input():
    return {
        "days": 1,
        "weekdayOfDay1": 0,
        "dayTypeByDate": ["A"],
        "needTemplate": {
            "A": {
                "7-9": 1,
                "9-15": 1,
                "16-18": 0,
                "18-24": 2,
                "0-7": 0,
            }
        },
        "people": [],
        "previousMonthNightCarry": {"NA": [], "NB": [], "NC": []},
        "shifts": deepcopy(solver.SHIFT_CATALOG),
        "strictNight": {
            "18-21_min": 0,
            "18-21_max": 0,
            "21-23": 0,
            "0-7": 0,
        },
    }


def test_positive_need_without_availability_triggers_error():
    data = build_base_input()
    result = solver.solve(data)

    assert "error" in result, "Solver should return an error when no availability exists."
    assert result["error"]["code"] == "no_availability"
    diagnostics = result.get("diagnostics", {})
    availability = diagnostics.get("availability", {})
    assert availability, "Availability diagnostics should be present in the error response."
    first_day = availability.get("1") or availability.get(1)
    assert isinstance(first_day, dict)
    assert first_day.get("7-9", 0) == 0
