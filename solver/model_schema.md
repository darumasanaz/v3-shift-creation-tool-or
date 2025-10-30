# Solver Input Schema

This document summarises the JSON structure consumed by `solver.py`. All fields
are required unless noted as optional.

## Top-Level Fields

| Field | Type | Description |
| --- | --- | --- |
| `year` | integer | Target calendar year. |
| `month` | integer | Target calendar month (1-12). |
| `days` | integer | Number of days in the scheduling horizon (starting from the 1st). |
| `weekdayOfDay1` | integer | Weekday index of day 1 (0 = Sun, 6 = Sat). |
| `previousMonthNightCarry` | object | Carries staff from previous month for night shifts. Keys are shift codes (`NA`, `NB`, `NC`). |
| `shifts` | array | Shift definitions. Each entry is an object with `code`, `name`, `start`, and `end` (hour integers). |
| `needTemplate` | object | Map of day type → slot requirements (`7-9`, `9-15`, `16-18`, `18-24`, `0-7`). |
| `dayTypeByDate` | array | Length = `days`. Specifies which template applies to each date. |
| `strictNight` | object | Night staffing requirements (`21-23`, `0-7`, `18-21_min`, `18-21_max`). |
| `people` | array | Staff definitions (see below). |
| `rules` | object | Boolean/parameter flags for optional rules. |
| `weights` | object | Objective weights (see below). |

## People

Each person entry supports the following properties:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Unique identifier. |
| `canWork` | array[string] | yes | Allowed shift codes. |
| `fixedOffWeekdays` | array[string or int] | no | Weekday names or indexes (0-6) for fixed days off. |
| `weeklyMax` | integer | no | Maximum number of assignments per ISO week. `0` or omitted disables the limit. |
| `monthlyMax` | integer | no | Maximum number of assignments in the horizon. `0` or omitted disables the limit. |
| `consecMax` | integer | no | Maximum consecutive days on duty. |
| `unavailableDates` | array[integer] | no | Dates (1-indexed) that are strictly off-limits. |
| `requestedOffDates` | array[integer] | no | Dates that should be avoided if possible. |
| `requestedOffWeight` | integer | no | Penalty weight to use when violating a requested off day. Falls back to the global weight when omitted. |

## Weights

| Weight | Description | Default |
| --- | --- | --- |
| `W_shortage` | Penalty for unmet demand (hard constraint, kept for compatibility). | 1000 |
| `W_overstaff_gt_need_plus1` | Penalty multiplier for staffing beyond `need + 1`. | 5 |
| `W_balance_workdays` | (Reserved) Workday balancing weight. | 1 |
| `W_prefer_fill_morning7_9` | (Reserved) Incentive to fill morning slots. | 10 |
| `W_fill_9_15` | (Reserved) Incentive to fill 9-15 slots. | 3 |
| `W_requested_off_violation` | Penalty per person-day when a requested off day is worked, used when the individual weight is not supplied. | 20 |

Unspecified weights should fall back to the defaults used in `sample_input.json`.
