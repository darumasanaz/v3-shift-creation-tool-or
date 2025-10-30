import json
from pathlib import Path

from solver import solver


def test_shift_code_alignment():
    repo_root = Path(__file__).resolve().parent.parent
    catalog_path = repo_root / 'solver' / 'shifts_catalog.json'
    frontend_constants_path = repo_root / 'frontend' / 'src' / 'constants' / 'shifts.ts'

    assert catalog_path.exists(), 'Shift catalog file is missing.'
    assert frontend_constants_path.exists(), 'Frontend shift constants file is missing.'

    catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
    codes_from_catalog = [entry['code'] for entry in catalog]

    assert codes_from_catalog == solver.SHIFT_CODE_LIST

    frontend_source = frontend_constants_path.read_text(encoding='utf-8')
    assert 'shifts_catalog.json' in frontend_source
