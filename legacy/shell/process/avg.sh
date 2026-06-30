
COLUMN_INDEX=2   # 动态指定要计算的列（0-based索引）
SEPARATOR=","     # 动态指定列的分隔符
c=$1
t=$2
n=$3
d=$4

bash q.sh $c $t $n $d | jq --arg col "$COLUMN_INDEX" --arg sep "$SEPARATOR" '
  ($col | tonumber) as $col
  | ($sep) as $sep
  | .data.klines as $klines
  | ([$klines[] | split($sep)[$col] | tonumber] | add / length) as $average
  | $klines[-1] as $last_line
  | ($last_line | split($sep)[$col] | tonumber) as $last_line_col
  | ((($last_line_col - $average) / $average) * 100) as $percentage_change
  | {
      avg: $average,
      last_line: $last_line,
      last_c: $last_line_col,
      up: $percentage_change
    }
'
