import json, argparse
from ortools.sat.python import cp_model

SLOTS = ["0-7", "7-9", "9-15", "16-18", "18-21", "21-23"]
SUMMARY_SLOTS = ["7-9", "9-15", "16-18", "18-21", "21-23", "0-7"]


def overlap(start, end, a, b):
    return not (end <= a or b <= start)

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
        "totals": {"shortage": 0, "overstaff": 0, "requestedOffViolations": 0},
    }
    requested_off_map = {
        person.get("id"): set(person.get("requestedOffDates", []))
        for person in data.get("people", [])
    }

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
            summary["totals"]["requestedOffViolations"] += 1

    return summary


def estimate_slot_max_possible(data):
    days = range(1, data["days"] + 1)
    staff = data["people"]
    shifts = data["shifts"]

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

    def weekday_of(d):
        return (data["weekdayOfDay1"] + (d - 1)) % 7

    slot_capacity = {}
    for d in days:
        wd = weekday_of(d)
        for slot in SUMMARY_SLOTS:
            count = 0
            for person in staff:
                offs = set(fixed_map.get(w, w) for w in person.get("fixedOffWeekdays", []))
                if wd in offs:
                    continue
                can = set(person.get("canWork", []))
                possible = any(
                    shift["code"] in can and slot_contributes(shift, slot) for shift in shifts
                )
                if possible:
                    count += 1
            slot_capacity[(d, slot)] = count
    return slot_capacity

def solve(data, time_limit=10.0):
    days = range(1, data["days"]+1)
    staff = data["people"]
    shifts = data["shifts"]
    I = range(len(staff))
    K = range(len(shifts))

    m = cp_model.CpModel()

    # decision vars
    x = {(d,i,k): m.NewBoolVar(f"x_d{d}_i{i}_k{k}") for d in days for i in I for k in K}
    work = {(d,i): m.NewBoolVar(f"work_d{d}_i{i}") for d in days for i in I}

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

    for d in days:
        wd = weekday_of(d)
        for i, p in enumerate(staff):
            offs = set(fixed_map.get(w, w) for w in p.get("fixedOffWeekdays",[]))
            if wd in offs:
                m.Add(sum(x[d,i,k] for k in K) == 0)

    # 3b) 週上限
    weeks = split_weeks(data["days"], data["weekdayOfDay1"])
    for i, p in enumerate(staff):
        wmax = p.get("weeklyMax", 0)
        if wmax and wmax > 0:
            for a, b in weeks:
                m.Add(sum(work[d, i] for d in range(a, b + 1)) <= wmax)

    # 3c) 月間上限
    for i, p in enumerate(staff):
        mmax = p.get("monthlyMax", 0)
        if mmax and mmax > 0:
            m.Add(sum(work[d, i] for d in days) <= mmax)

    # 3d) 特定日NG
    for i, p in enumerate(staff):
        unavailable = set(p.get("unavailableDates", []))
        for d in days:
            if d in unavailable:
                m.Add(sum(x[d, i, k] for k in K) == 0)

    # 4) 夜勤明け休み
    idxNA, idxNB, idxNC = code_index.get("NA"), code_index.get("NB"), code_index.get("NC")
    for d in days:
        for i in I:
            if idxNA is not None:
                if d+1 in days:
                    m.Add(work[d+1,i] == 0).OnlyEnforceIf(x[d,i,idxNA])
                if d+2 in days:
                    m.Add(work[d+2,i] == 0).OnlyEnforceIf(x[d,i,idxNA])
            if idxNC is not None:
                if d+1 in days:
                    m.Add(work[d+1,i] == 0).OnlyEnforceIf(x[d,i,idxNC])
            # NBは制限なし

    # 5) 最大連勤
    for i, p in enumerate(staff):
        L = p.get("consecMax", 5)
        if L <= 0: 
            continue
        for start in days:
            window = [t for t in range(start, start+L+1) if t in days]
            if len(window) == L+1:
                m.Add(sum(work[t,i] for t in window) <= L)

    # 6) 前日がDA/DB → 翌日EA不可
    if data["rules"].get("noEarlyAfterDayAB", True):
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

    # 7) 夜間厳格
    for d in days:
        # 21-23 == 2
        m.Add(s[d,"21-23"] == 2)
        # 0-7 == 2（d=1はcarryを考慮）
        carry = 0
        if d == 1:
            for key in ("NA","NB","NC"):
                carry += len(data["previousMonthNightCarry"].get(key, []))
            rhs = max(0, 2 - carry)
            m.Add(s[d,"0-7"] == rhs)
        else:
            m.Add(s[d,"0-7"] == 2)
        # 18-21: 2〜3
        m.Add(s[d,"18-21"] >= 2)
        m.Add(s[d,"18-21"] <= 3)

    # 8) 日中下限 + 9) need+1超の過剰ペナルティ
    weights = data["weights"]
    penalties = []

    default_requested_weight = weights.get("W_requested_off_violation", 20)
    for i, p in enumerate(staff):
        requested = set(p.get("requestedOffDates", []))
        if not requested:
            continue
        weight = p.get("requestedOffWeight", default_requested_weight)
        for d in requested:
            if d in days:
                viol = m.NewBoolVar(f"requested_off_violation_d{d}_i{i}")
                m.Add(viol >= work[d, i])
                m.Add(viol <= work[d, i])
                penalties.append(weight * viol)

    for d in days:
        dayType = data["dayTypeByDate"][d-1]
        needs = data["needTemplate"][dayType]
        for slot in ["7-9","9-15","16-18"]:
            need = needs[slot]
            m.Add(s[d,slot] >= need)
            ex = m.NewIntVar(0, bigN, f"ex_d{d}_{slot}")
            m.Add(ex >= s[d,slot] - (need + 1))
            m.Add(ex >= 0)
            penalties.append(weights["W_overstaff_gt_need_plus1"] * ex)

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
        out["diagnostics"] = {"unmetCandidates": diagnostics}
        out.setdefault(
            "summary",
            {
                "shortage": [],
                "overstaff": [],
                "totals": {"shortage": 0, "overstaff": 0, "requestedOffViolations": 0},
            },
        )
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
