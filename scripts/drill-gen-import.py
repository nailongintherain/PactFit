#!/usr/bin/env python3
# =============================================================================
# scripts/drill-gen-import.py —— 把私有 JSON 备份转成可执行的导入 SQL
#
# 设计原则：
#   1. 不连接任何数据库，只读本地 JSON，产出纯 SQL 文本
#   2. 绝不把个人数据写进仓库：输出路径经 realpath 解析后若落在仓库内即拒绝
#   3. 输出文件权限 0o600、所在目录 0o700（防止同机其他用户读到）
#   4. 用 jsonb_populate_recordset 整体灌注，避免逐值转义出错
#   5. 保留原始 id / space_id / created_at / jsonb：
#      靠 OVERRIDING SYSTEM VALUE + 原样 JSON
#   6. 任何报错只输出「表名 / 列名 / 行序号」，绝不输出字段值
#
# 用法：
#   python3 scripts/drill-gen-import.py \
#     --src    "$HOME/Downloads/PactFit-backups/PactFit-backup-2026-10-19/raw" \
#     --out    "$HOME/PactFit-drill/20_import.sql" \
#     --expect "$HOME/PactFit-drill/expected.json"
#
# 产出：
#   20_import.sql   —— 6 张表的 INSERT（空表自动跳过），含 begin/commit
#   expected.json   —— 行数、逐列空值计数、辅助指纹（不含任何字段值）
# =============================================================================
#
# 【关于 INSERT ... OVERRIDING SYSTEM VALUE ... SELECT ... jsonb_populate_recordset】
# 合法性依据（**静态核对 PostgreSQL 17 官方文档，尚未在本机实际运行**）：
#
#   a) 子句位置：PG 17 `INSERT` 语法概要为
#        INSERT INTO table_name [ AS alias ] [ ( column_name [, ...] ) ]
#            [ OVERRIDING { SYSTEM | USER } VALUE ]
#            { DEFAULT VALUES | VALUES (...) | query }
#      即 OVERRIDING SYSTEM VALUE 位于「列清单之后、数据来源之前」，
#      因此 `INSERT INTO t (c1, c2) OVERRIDING SYSTEM VALUE SELECT ...` 合法。
#      出处：https://www.postgresql.org/docs/17/sql-insert.html
#
#   b) 函数签名：`jsonb_populate_recordset(base anyelement, from_json jsonb)
#      → setof anyelement`，`null::public.<table>` 是文档给出的标准用法
#      （基值为 NULL 时，JSON 中缺失的列填 SQL NULL）。
#      出处：https://www.postgresql.org/docs/17/functions-json.html
#
#   c) 由此本脚本采用**显式列清单 + 显式取值**的写法：
#        INSERT INTO public.t (a, b, ...) OVERRIDING SYSTEM VALUE
#        SELECT t.a, t.b, ... FROM jsonb_populate_recordset(null::public.t, $j$…$j$::jsonb) AS t;
#      两侧都写明列名，不依赖 `SELECT t.*` 的位置对应，列顺序写错也不会串列。
#
#   d) 已知语义坑（文档明示，不是猜测）：
#      · JSON 里「有键但值为 null」与「根本没有这个键」在填充后同为 SQL NULL，无法区分；
#      · JSON 里存在、但表里没有同名列的键会被**静默忽略** ——
#        所以本脚本先用 COLUMN_SPEC 做键校验，多一个键就报错退出；
#      · NOT NULL 且带 DEFAULT 的列若在 JSON 中缺失，会填 NULL 并触发 23502，
#        而**不会**回落到 DEFAULT —— 所以 NOT NULL 列必须出现在 JSON 里。
#      · numeric(5,1) 会对超出一位小数的输入做四舍五入，这属于类型转换而非数据丢失，
#        比对脚本 drill-compare.py 按同样规则量化后再比。
# =============================================================================

import argparse
import hashlib
import json
import os
import secrets
import sys
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# -----------------------------------------------------------------------------
# 列清单基线：必须与 backend/schema/drill/10_tables.sql 及
#              backend/schema/schema-reference.sql（脱敏参考）完全一致。
# 结构：(列名, 类型, 是否 NOT NULL, identity 类型 'a'=ALWAYS / ''=无)
# 用途：① 键校验（防静默忽略）② expected.json 的逐列空值统计 ③ 显式列清单
# -----------------------------------------------------------------------------
COLUMN_SPEC = {
    "profiles": [
        ("id", "bigint", True, "a"),
        ("owner_id", "text", True, ""),
        ("owner_name", "text", False, ""),
        ("space_id", "text", True, ""),
        ("nickname", "text", True, ""),
        ("role", "text", True, ""),
        ("start_weight", "numeric", False, ""),
        ("target_weight", "numeric", False, ""),
        ("target_date", "date", False, ""),
        ("created_at", "timestamp", True, ""),
    ],
    "records": [
        ("id", "bigint", True, "a"),
        ("owner_id", "text", True, ""),
        ("owner_name", "text", False, ""),
        ("space_id", "text", True, ""),
        ("record_date", "date", True, ""),
        ("weight", "numeric", True, ""),
        ("tags", "jsonb", False, ""),
        ("todo_done", "jsonb", False, ""),
        ("mood", "text", False, ""),
        ("note", "text", False, ""),
        ("created_at", "timestamp", True, ""),
    ],
    "tags": [
        ("id", "bigint", True, "a"),
        ("owner_id", "text", True, ""),
        ("owner_name", "text", False, ""),
        ("space_id", "text", True, ""),
        ("text", "text", True, ""),
        ("sort", "integer", True, ""),
        ("created_at", "timestamp", True, ""),
    ],
    "todos": [
        ("id", "bigint", True, "a"),
        ("owner_id", "text", True, ""),
        ("owner_name", "text", False, ""),
        ("space_id", "text", True, ""),
        ("text", "text", True, ""),
        ("sort", "integer", True, ""),
        ("created_at", "timestamp", True, ""),
    ],
    "rewards": [
        ("id", "bigint", True, "a"),
        ("owner_id", "text", True, ""),
        ("owner_name", "text", False, ""),
        ("space_id", "text", True, ""),
        ("condition_text", "text", True, ""),
        ("target_weight", "numeric", False, ""),
        ("prize", "text", True, ""),
        ("promise_by", "text", True, ""),
        ("status", "text", True, ""),
        ("achieved_at", "timestamp", False, ""),
        ("redeemed_at", "timestamp", False, ""),
        ("created_at", "timestamp", True, ""),
    ],
    "messages": [
        ("id", "bigint", True, "a"),
        ("owner_id", "text", True, ""),
        ("owner_name", "text", False, ""),
        ("space_id", "text", True, ""),
        ("text", "text", True, ""),
        ("created_at", "timestamp", True, ""),
    ],
}

TABLES = ["profiles", "records", "todos", "tags", "rewards", "messages"]


# =============================================================================
# 路径与权限
# =============================================================================
def is_inside_repo(path: str) -> bool:
    """用 realpath 解析后再判断，符号链接指回仓库也会被识别。"""
    p = os.path.realpath(os.path.expanduser(path))
    r = os.path.realpath(REPO_ROOT)
    try:
        return os.path.commonpath([p, r]) == r
    except ValueError:          # 不同盘符 / 不同根
        return False


def write_private(path: str, text: str) -> None:
    """以 0o600 写文件，目录 0o700；不用 umask 兜底，显式 chmod。"""
    d = os.path.dirname(path) or "."
    os.makedirs(d, mode=0o700, exist_ok=True)
    os.chmod(d, 0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
    finally:
        os.chmod(path, 0o600)


# =============================================================================
# 校验
# =============================================================================
def validate_rows(tbl: str, rows):
    """只报列名与行序号，绝不把值写进异常。"""
    spec = COLUMN_SPEC[tbl]
    allowed = {c[0] for c in spec}
    required = {c[0] for c in spec if c[2]}          # NOT NULL 必须出现
    for i, r in enumerate(rows, 1):
        if not isinstance(r, dict):
            sys.exit(f"[错误] {tbl} 第 {i} 行不是对象")
        extra = sorted(set(r) - allowed)
        if extra:
            sys.exit(f"[错误] {tbl} 第 {i} 行存在表里没有的键：{', '.join(extra)}\n"
                     f"       jsonb_populate_recordset 会静默忽略它们，宁可停手。")
        missing = sorted(required - set(r))
        if missing:
            sys.exit(f"[错误] {tbl} 第 {i} 行缺少 NOT NULL 列：{', '.join(missing)}\n"
                     f"       缺失会填 SQL NULL 并触发 23502，不会回落到 DEFAULT。")
        for col in allowed:
            if r.get(col) is None and col in required:
                sys.exit(f"[错误] {tbl} 第 {i} 行的 {col} 是 null，但该列 NOT NULL")


def epoch_seconds(ts) -> int:
    """与 SQL 侧 round(extract(epoch from created_at)) 对齐（仅用于辅助指纹）。"""
    if not isinstance(ts, str):
        return 0
    s = ts.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return round(dt.timestamp())


def fingerprint(rows):
    """辅助指标，不是验收主口径（主口径是 drill-compare.py 的逐字段比对）。"""
    if not rows:
        return "EMPTY"
    parts = []
    for r in sorted(rows, key=lambda x: x["id"]):
        parts.append(f'{r["id"]}|{r["owner_id"]}|{epoch_seconds(r["created_at"])}')
    return hashlib.md5(",".join(parts).encode()).hexdigest()


def null_counts(tbl: str, rows):
    out = {}
    for name, _t, _nn, _i in COLUMN_SPEC[tbl]:
        out[name] = sum(1 for r in rows if r.get(name) is None)
    return out


# =============================================================================
# 生成
# =============================================================================
def build_insert(tbl: str, rows) -> str:
    cols = [c[0] for c in COLUMN_SPEC[tbl]]
    payload = json.dumps(rows, ensure_ascii=False)
    tag = "$j$"
    while tag in payload:
        tag = f"$j{secrets.token_hex(3)}$"

    col_list = ", ".join(cols)
    val_list = ", ".join(f"t.{c}" for c in cols)
    return (
        f"-- {tbl}: {len(rows)} 行\n"
        f"insert into public.{tbl} ({col_list}) overriding system value\n"
        f"select {val_list}\n"
        f"  from jsonb_populate_recordset(null::public.{tbl}, {tag}{payload}{tag}::jsonb) as t;\n"
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="raw/ 目录（含 6 张表 json）")
    ap.add_argument("--out", required=True, help="输出 20_import.sql 的路径（仓库外）")
    ap.add_argument("--expect", required=True, help="输出 expected.json 的路径（仓库外）")
    args = ap.parse_args()

    src = os.path.realpath(os.path.expanduser(args.src))
    out = os.path.realpath(os.path.expanduser(args.out))
    exp = os.path.realpath(os.path.expanduser(args.expect))

    # --- 隐私闸门 1：输出不得落在仓库内（含符号链接绕过） -------------------
    for p in (out, exp):
        if is_inside_repo(p):
            sys.exit(f"[拒绝] 输出路径解析后位于仓库内：{p}\n"
                     f"       私有数据不得落进 Git 工作区（realpath 已解析符号链接）。")
    if out == exp:
        sys.exit("[拒绝] --out 与 --expect 指向同一个文件")

    # --- 隐私闸门 2：源目录若在仓库里，说明备份已被误提交 ------------------
    if is_inside_repo(src):
        sys.exit(f"[拒绝] 源目录位于仓库内：{src}\n"
                 f"       私有备份不应出现在 Git 工作区，请先移出。")

    if not os.path.isdir(src):
        sys.exit(f"[错误] 源目录不存在：{src}")

    stamp = datetime.now().astimezone().isoformat(timespec="seconds")
    chunks = [
        "-- =====================================================================",
        "-- 20_import.sql —— 自动生成，含个人数据，演练结束必须删除，切勿提交",
        f"-- 生成时间：{stamp}",
        "-- 执行：psql -v ON_ERROR_STOP=1 -f 20_import.sql   （文件自带 begin/commit）",
        "-- =====================================================================",
        "\\set ON_ERROR_STOP on",
        "begin;",
        "set local client_min_messages = warning;",
        "",
    ]
    expected = {"generated_at": stamp, "tables": {}, "total": 0}

    for t in TABLES:
        path = os.path.join(src, f"{t}.json")
        if not os.path.exists(path):
            sys.exit(f"[错误] 缺少 {path}")
        with open(path, encoding="utf-8") as f:
            rows = json.load(f)
        if not isinstance(rows, list):
            sys.exit(f"[错误] {path} 顶层不是数组")

        validate_rows(t, rows)

        expected["tables"][t] = {
            "rows": len(rows),
            "columns": [c[0] for c in COLUMN_SPEC[t]],
            "nulls": null_counts(t, rows),
            "fingerprint": fingerprint(rows),
        }
        expected["total"] += len(rows)

        if not rows:
            chunks.append(f"-- {t}: 0 行，跳过（表已存在，保持空表即可）\n")
            continue

        chunks.append(build_insert(t, rows))

    chunks.append("commit;")

    write_private(out, "\n".join(chunks) + "\n")
    os.chmod(out, 0o600)
    write_private(exp, json.dumps(expected, ensure_ascii=False, indent=2) + "\n")

    print(f"已生成：{out}  (mode 600)")
    print(f"已生成：{exp}  (mode 600)")
    print("行数：" + ", ".join(f"{t}={expected['tables'][t]['rows']}" for t in TABLES)
          + f"，合计 {expected['total']}")
    print("提示：这两个文件含个人数据，演练结束后删除；不要复制进仓库，不要贴进聊天记录。")


if __name__ == "__main__":
    main()
