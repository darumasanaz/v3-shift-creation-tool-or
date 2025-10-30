import json, argparse
from ortools.sat.python import cp_model

SLOTS = ["0-7","7-9","9-15","16-18","18-21","21-23"]

def overlap(start, end, a, b):
    return not (end <= a or b <= start)

def slot_contributes(shift, slot_label):
    a, b = map(int, slot_label.split("-"))
    return overlap(shift["start"], shift["end"], a, b)

def solve(data):
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

    # 4) 夜勤明け休み
    rest = data["rules"]["nightRest"]
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
    solver.parameters.max_time_in_seconds = 10.0
    res = solver.Solve(m)

    out = {"assignments": [], "summary": {"shortage": [], "overstaff": []}}
    if res in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for d in days:
            for i in I:
                for k in K:
                    if solver.Value(x[d,i,k]) == 1:
                        out["assignments"].append({
                            "date": d,
                            "staffId": staff[i]["id"],
                            "shift": shifts[k]["code"]
                        })
    else:
        out["infeasible"] = True
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", required=True)
    ap.add_argument("--out", dest="outfile", required=True)
    args = ap.parse_args()

    data = json.load(open(args.infile, "r", encoding="utf-8"))
    result = solve(data)
    json.dump(result, open(args.outfile, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"wrote {args.outfile}")

if __name__ == "__main__":
    main()
