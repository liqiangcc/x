
# 定义一个函数
extractCodeAndName() {
  # 调用 q.sh 脚本并处理输出
  bash q.sh "$1" 5 1 20501217 | jq .data | jq -r '
    if .klines | length > 0 then
      "\(.code),\(.name)"
    else
      empty
    end
  '
}

for i in {1..200000}; do
  c=$(printf "%06d\n" "$i")
  result=$(extractCodeAndName 0.$c)
  t=0
  if [ -z "$result" ]; then
    # 如果第一个参数为空，尝试第二个参数
    result=$(extractCodeAndName 1.$c)
    t=1
    if [ -z "$result" ]; then
      # 如果第二个参数为空，尝试第三个参数
      result=$(extractCodeAndName 2.$c)
      t=2
    fi
    if [ -z "$result" ]; then
      # 如果第二个参数为空，尝试第三个参数
      result=$(extractCodeAndName 3.$c)
      t=3
    fi
  fi
    if [[ -n "$result" ]]; then
       echo "$result,$t.$c"
    fi   
done

