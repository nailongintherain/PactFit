#!/usr/bin/env python3
# =============================================================================
# scripts/drill-compare.py —— 恢复结果 vs 备份源文件 的逐表/逐行/逐字段保真比对
#
# 为什么需要它：
#   40_verify.sql 在库内只能自证"库里长这样"，无法把备份 JSON 当成期望值塞进去比对
#   （否则就要把个人数据再灌一遍）。所以逐字段比对放在库外：
#     raw/*.json（源）  vs  to_jsonb(恢复后的行)（实）
#   两侧都是"语义值"，比的是数据本身，不是某一种序列化写法。
#
# 三种单元格结论（Phase 1-c-fix-2 新增第三态）：
#   match     两侧语义完全相等
#   quantized 源值超出目标字段精度，按目标类型量化后相等 —— **明确报告，不算无损**
#             （典型：numeric(5,1) 把两位小数四舍五入；timestamptz 秒后 6 位以外被截断；
#               源里带时分秒的值落进 date 列）
#   diff      量化后仍不相等 —— 真差异
#
# 判据：
#   任何 diff                 → 退出码 1
#   只有 quantized            → 默认退出码 0，但逐列打印"量化 N"，并在总账里单列
#   --strict-precision        → 把 quantized 也当失败（要求零量化时用）
#
# 输入：
#   --src     私有备份的 raw/ 目录（6 个 json）
#   --actual  由 50_dump.sql 导出、docker cp 出来的 pactfit-actual.json
#   --expect  可选：drill-gen-import.py 生成的 expected.json，用于确认
#             "源文件自生成导入 SQL 之后没被改过"
#   --purge-on-pass  比对 PASS 后删除 --actual 文件（含个人数据的临时导出）
#
# 输出：只有 表名 / 列名 / 行数 / 计数 / PASS-FAIL，绝不打印任何字段值。
# =============================================================================

import argparse
import hashlib
import json
import os
import re
import stat
import sys
from datetime import date as _date, datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

TABLES = ["profiles", "records", "todos", "tags", "rewards", "messages"]

# 每列的语义类型。未列出的按 text 处理。
# 与 drill-gen-import.py 的 COLUMN_SPEC 对应，只保留需要特殊归一化的列。
KIND = {
    "id": "int",
    "sort": "int",
    "weight": "numeric",
    "start_weight": "numeric",
    "target_weight": "numeric",
    "target_date": "date",
    "record_date": "date",
    "created_at": "ts",
    "achieved_at": "ts",
    "redeemed_at": "ts",
    "tags": "jsonb",
    "todo_done": "jsonb",
}

QUANT = Decimal("0.1")


def kind_of(col: str) -> str:
    return KIND.get(col, "text")


# =============================================================================
# 归一化与三态比较
# =============================================================================
# 时间字符串：日期 + 时分秒 + 可选小数秒 + 可选时区
_TS_RE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$"
)
TS_QUANT = Decimal("0.000001")      # timestamptz 的微秒精度


def _ts_decimal(v):
    """把时间字符串换成「以秒为单位的精确十进制数」。

    为什么不先解析成 datetime：Python 的 datetime 只有微秒精度，
    fromisoformat 会把 9 位小数**截断**；而 PostgreSQL 的 timestamptz 是
    **四舍五入**到微秒。两者在 .123456789 这类值上会差 1µs，
    进而被误判成"真实差异"。这里保留原始小数位的全部精度，
    再按 PG 的规则（HALF_UP）量化，才能区分 match / quantized / diff。
    """
    s = str(v).strip()
    m = _TS_RE.match(s)
    if not m:
        raise ValueError("unrecognized timestamp")
    y, mo, d, hh, mi, ss, frac, tz = m.groups()
    base = Decimal(int(datetime(int(y), int(mo), int(d), int(hh), int(mi), int(ss),
                               tzinfo=timezone.utc).timestamp()))
    if tz and tz != "Z":
        sign = 1 if tz[0] == "+" else -1
        body = tz[1:].replace(":", "")
        base -= sign * (int(body[:2]) * 3600 + int(body[2:]) * 60)
    if frac:
        base += Decimal("0." + frac)
    return base


def _dec(v):
    try:
        return Decimal(str(v))
    except (InvalidOperation, ValueError):
        return None


def compare_cell(kind: str, src, act) -> str:
    """返回 'match' / 'quantized' / 'diff'。"""
    if src is None and act is None:
        return "match"
    if src is None or act is None:
        return "diff"

    if kind == "int":
        try:
            return "match" if int(src) == int(act) else "diff"
        except (TypeError, ValueError):
            return "diff"

    if kind == "numeric":
        a, b = _dec(src), _dec(act)
        if a is None or b is None:
            return "diff"
        if a == b:
            return "match"
        # 量化后相等 → 源值精度超出 numeric(p,s)
        return "quantized" if a.quantize(QUANT, rounding=ROUND_HALF_UP) == b else "diff"

    if kind == "date":
        s = str(src).strip()
        t = str(act).strip()
        s_day = s[:10]
        t_day = t[:10]
        if isinstance(act, _date) and not isinstance(act, datetime):
            t_day = act.isoformat()
        if s_day != t_day:
            return "diff"
        # 源里带时分秒、目标只存日期 → 截断
        if len(s) > 10:
            return "quantized"
        return "match"

    if kind == "ts":
        try:
            a = _ts_decimal(src)
            b = _ts_decimal(act)
        except (ValueError, TypeError):
            return "diff"
        if a == b:
            return "match"                       # 完全相等，含小数位恰好 ≤ 6 位
        # 超出微秒的位数按 PG 的规则四舍五入后再比（PG 是 round，不是 truncate）
        if a.quantize(TS_QUANT, rounding=ROUND_HALF_UP) == b:
            return "quantized"
        return "diff"

    if kind == "jsonb":
        # jsonb 会重排键、去重空格，所以比语义而不是文本
        da = json.dumps(src, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        db = json.dumps(act, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        return "match" if da == db else "diff"

    return "match" if str(src) == str(act) else "diff"


# =============================================================================
# 读入
# =============================================================================
def load_source(src: str):
    out = {}
    for t in TABLES:
        p = os.path.join(src, f"{t}.json")
        if not os.path.exists(p):
            sys.exit(f"[错误] 缺少源文件：{p}")
        with open(p, encoding="utf-8") as f:
            rows = json.load(f)
        if not isinstance(rows, list):
            sys.exit(f"[错误] {p} 顶层不是数组")
        out[t] = rows
    return out


def load_actual(path: str):
    """50_dump.sql 的输出：第一行是 JSON，后面可能跟一行 '(1 row)'。"""
    with open(path, encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if s.startswith("{"):
                obj = json.loads(s)
                if not isinstance(obj, dict):
                    sys.exit("[错误] actual 文件顶层不是对象")
                return obj
    sys.exit(f"[错误] 在 {path} 里没找到以 '{{' 开头的 JSON 行")


# =============================================================================
# 比对
# =============================================================================
def compare_table(t: str, src_rows, act_rows):
    """返回 (verdict, lines, stats)。verdict ∈ PASS / PASS(量化 N) / FAIL。"""
    lines = []
    failed = False
    quantized_total = 0

    src_by_id = {r["id"]: r for r in src_rows}
    act_by_id = {r["id"]: r for r in act_rows}

    # 1) 行数
    n_ok = len(src_rows) == len(act_rows)
    failed |= not n_ok
    lines.append(f"  行数            源 {len(src_rows):>3} / 库 {len(act_rows):>3}"
                 f"   {'PASS' if n_ok else 'FAIL'}")

    # 1b) 主键重复：字典是按 id 覆盖的，重复会让"后一条盖掉前一条"从而漏检，
    #     所以必须在建字典前后各算一次长度差，不能只看行数对不对。
    dup_src = len(src_rows) - len(src_by_id)
    dup_act = len(act_rows) - len(act_by_id)
    dup_ok = dup_src == 0 and dup_act == 0
    failed |= not dup_ok
    lines.append(f"  id 重复         源 {dup_src:>3} / 库 {dup_act:>3}"
                 f"   {'PASS' if dup_ok else 'FAIL'}"
                 + ("" if dup_ok else "   （重复 id 会互相覆盖，逐字段结果不可信）"))

    # 2) 主键集合
    missing = sorted(set(src_by_id) - set(act_by_id))
    extra = sorted(set(act_by_id) - set(src_by_id))
    id_ok = not missing and not extra
    failed |= not id_ok
    lines.append(f"  id 集合         缺 {len(missing)} / 多 {len(extra)}"
                 f"   {'PASS' if id_ok else 'FAIL'}")

    # 3) 列集合（库里有、源里没有 → 说明比对漏了字段，必须当失败）
    src_cols = set()
    for r in src_rows:
        src_cols |= set(r)
    act_cols = set()
    for r in act_rows:
        act_cols |= set(r)
    col_extra = sorted(act_cols - src_cols)
    col_missing = sorted(src_cols - act_cols)
    col_ok = not col_extra and not col_missing
    failed |= not col_ok
    lines.append(f"  列集合          库多 {len(col_extra)} / 库少 {len(col_missing)}"
                 f"   {'PASS' if col_ok else 'FAIL'}"
                 + (f"   [库多: {', '.join(col_extra)}]" if col_extra else "")
                 + (f"   [库少: {', '.join(col_missing)}]" if col_missing else ""))

    # 4) 逐字段（三态）
    cols = sorted(src_cols | act_cols)
    checked = 0
    total_diff = 0
    for col in cols:
        if col not in src_cols or col not in act_cols:
            continue
        kind = kind_of(col)
        diffs = []
        quants = []
        for rid in sorted(set(src_by_id) & set(act_by_id)):
            checked += 1
            r = compare_cell(kind, src_by_id[rid].get(col), act_by_id[rid].get(col))
            if r == "diff":
                diffs.append(rid)
            elif r == "quantized":
                quants.append(rid)
        total_diff += len(diffs)
        quantized_total += len(quants)
        if diffs:
            failed = True
            idx = "、".join(f"第 {i} 行" for i in range(1, min(len(diffs), 5) + 1))
            more = "" if len(diffs) <= 5 else f" 等 {len(diffs)} 处"
            lines.append(f"    {col:<16} 差异 {len(diffs):>3} / {len(act_by_id):<3}"
                         f"  量化 {len(quants):>2}   FAIL   （{idx}{more}）")
        elif quants:
            lines.append(f"    {col:<16} 差异   0 / {len(act_by_id):<3}"
                         f"  量化 {len(quants):>2}   PASS*  （源值精度超出目标字段，已量化后一致）")
        else:
            lines.append(f"    {col:<16} 差异   0 / {len(act_by_id):<3}"
                         f"  量化  0   PASS")

    if failed:
        verdict = "FAIL"
    elif quantized_total:
        verdict = f"PASS(量化 {quantized_total})"
    else:
        verdict = "PASS"

    lines.append(f"  字段比对        {checked} 次取值 / {total_diff} 差异 / "
                 f"{quantized_total} 量化   {verdict}")
    return verdict, lines, {"field_checks": checked, "field_diffs": total_diff,
                            "field_quantized": quantized_total,
                            "rows_act": len(act_rows)}


def fingerprint_of(rows):
    def epoch(ts):
        if not isinstance(ts, str):
            return 0
        s = ts.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return round(dt.timestamp())

    if not rows:
        return "EMPTY"
    parts = []
    for r in sorted(rows, key=lambda x: x["id"]):
        parts.append(f'{r["id"]}|{r["owner_id"]}|{epoch(r["created_at"])}')
    return hashlib.md5(",".join(parts).encode()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="私有备份 raw/ 目录")
    ap.add_argument("--actual", required=True, help="50_dump.sql 导出的 pactfit-actual.json")
    ap.add_argument("--expect", help="可选：expected.json（校验源文件未变）")
    ap.add_argument("--purge-on-pass", action="store_true",
                    help="比对通过后删除 --actual 文件（含个人数据的临时导出）")
    ap.add_argument("--strict-precision", action="store_true",
                    help="把'已量化'也视为失败（要求零精度损失时用）")
    args = ap.parse_args()

    src = os.path.realpath(os.path.expanduser(args.src))
    actual_path = os.path.realpath(os.path.expanduser(args.actual))

    print("=" * 74)
    print("V6d · 逐表逐行逐字段保真比对（源备份 vs 恢复结果）")
    print("=" * 74)

    # 0) 导出文件的权限：要求不宽于 0600
    try:
        mode = stat.S_IMODE(os.stat(actual_path).st_mode)
    except OSError as e:
        sys.exit(f"[错误] 读不到导出文件：{type(e).__name__}")
    if mode & 0o077:
        print(f"文件权限         {oct(mode)}   FAIL   应收紧为 0600：chmod 600 {actual_path}")
        sys.exit(1)
    print(f"文件权限         {oct(mode)}   PASS")

    # 1) 源文件自生成以来是否变过
    source = load_source(src)
    if args.expect:
        try:
            with open(os.path.realpath(os.path.expanduser(args.expect)), encoding="utf-8") as f:
                exp = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            sys.exit(f"[错误] expected.json 读不了：{type(e).__name__}")
        drift = []
        for t in TABLES:
            want = exp.get("tables", {}).get(t, {})
            if want.get("rows") != len(source[t]) or \
               want.get("fingerprint") != fingerprint_of(source[t]):
                drift.append(t)
        if drift:
            print(f"源文件一致性      FAIL  自生成导入 SQL 后发生过变化：{', '.join(drift)}")
            print("                  本次比对结果不可信，请重新生成 20_import.sql 并重跑演练。")
            sys.exit(1)
        print("源文件一致性      PASS  与 expected.json 一致（行数 + 辅助指纹）")
    print()

    actual = load_actual(actual_path)

    all_ok = True
    totals = {"tables": 0, "field_checks": 0, "field_diffs": 0,
              "field_quantized": 0, "rows": 0}

    for t in TABLES:
        act_rows = actual.get(t)
        if act_rows is None:
            print(f"=== {t} ===   FAIL   导出文件里没有这张表")
            all_ok = False
            continue
        verdict, lines, st = compare_table(t, source[t], act_rows)
        all_ok &= (verdict == "FAIL") is False
        totals["tables"] += 1
        totals["field_checks"] += st["field_checks"]
        totals["field_diffs"] += st["field_diffs"]
        totals["field_quantized"] += st["field_quantized"]
        totals["rows"] += st["rows_act"]
        print(f"=== {t} ===   {verdict}")
        for ln in lines:
            print(ln)
        print()

    print("-" * 74)
    print(f"合计：{totals['tables']} 张表 / {totals['rows']} 行 / "
          f"{totals['field_checks']} 次取值 / {totals['field_diffs']} 处差异 / "
          f"{totals['field_quantized']} 处量化")

    if totals["field_quantized"]:
        print("量化说明：以下计数表示源值与库值在**语义上不完全相同**，"
              "而是按目标字段精度量化后才相等 ——")
        print("          这不是无损失真，属类型转换。需要零量化时用 --strict-precision 复查。")

    strict_fail = args.strict_precision and totals["field_quantized"] > 0
    ok = all_ok and not strict_fail
    if strict_fail:
        print("严格口径：存在量化，按 --strict-precision 判 FAIL")
    print(f"V6d 结论：{'PASS' if ok else 'FAIL'}")
    print("说明：本脚本不输出任何字段值；差异只报列名与行序号。")

    if ok and args.purge_on_pass:
        try:
            os.remove(actual_path)
            print(f"已删除临时导出：{actual_path}")
        except OSError as e:
            print(f"[警告] 删除临时导出失败（{type(e).__name__}），请手动删除 {actual_path}")
    elif not ok:
        print(f"未删除临时导出（供排查）：{actual_path}")

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
