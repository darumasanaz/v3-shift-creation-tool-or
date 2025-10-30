from solver.solver import should_flag_summary_inconsistency


def test_summary_inconsistency_flagged():
    assert should_flag_summary_inconsistency(10, 0, 0) is True


def test_summary_inconsistency_not_flagged_when_need_zero():
    assert should_flag_summary_inconsistency(0, 0, 0) is False


def test_summary_inconsistency_not_flagged_when_shortage_reported():
    assert should_flag_summary_inconsistency(10, 5, 2) is False


def test_summary_inconsistency_not_flagged_when_assignments_meet_need():
    assert should_flag_summary_inconsistency(10, 10, 0) is False
