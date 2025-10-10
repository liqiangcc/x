#!/bin/bash

# --- 参数检查 ---
# 检查是否至少提供了一个参数（列名）
if [ -z "$1" ]; then
  echo "错误: 未提供列名。"
  echo "用法: $0 <column_name> [c12_value]"
  echo "例如: $0 c4                 (计算所有c12代码的c4列)"
  echo "例如: $0 c4 002439         (只计算c12代码为002439的c4列)"
  exit 1
fi

# --- 变量设置 ---
COLUMN_NAME=$1
C12_VALUE=$2  # 第二个参数，可以为空
DB_FILE="mydb.db"

# --- SQL 查询构建 ---
WHERE_CLAUSE=""
# 如果第二个参数（C12_VALUE）不为空，则构建 WHERE 子句
if [ -n "${C12_VALUE}" ]; then
  WHERE_CLAUSE="WHERE c12 = '${C12_VALUE}'"
fi

# SQL 查询模板
# 注意：即使只查询一个c12代码，PARTITION BY c12 仍然有效且无害
SQL_QUERY="
SELECT
    c1,
    c12,
    ${COLUMN_NAME},
    LAG(${COLUMN_NAME}, 1, 0) OVER (PARTITION BY c12 ORDER BY c1) AS previous_value,
    ${COLUMN_NAME} - LAG(${COLUMN_NAME}, 1, 0) OVER (PARTITION BY c12 ORDER BY c1) AS difference,
    CASE
        WHEN LAG(${COLUMN_NAME}, 1, 0) OVER (PARTITION BY c12 ORDER BY c1) = 0 THEN NULL
        ELSE (${COLUMN_NAME} - LAG(${COLUMN_NAME}, 1, 0) OVER (PARTITION BY c12 ORDER BY c1)) * 100.0 / LAG(${COLUMN_NAME}, 1, 0) OVER (PARTITION BY c12 ORDER BY c1)
    END AS percentage_change
FROM
    py
${WHERE_CLAUSE}
ORDER BY
    c12, c1;
"

# --- 执行查询 ---
echo "正在执行查询..."
./sql.sh "${DB_FILE}" "${SQL_QUERY}"