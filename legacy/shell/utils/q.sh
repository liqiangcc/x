#!/bin/bash
if [[ "$1" == *.* ]]; then
    secid="$1"          # 若 $1 含点号，直接赋值
else
    secid=$(bash "$(dirname "$0")/u_code_2_full.sh" "$1")  # 否则执行脚本转换
fi

klt=$2
lmt=$3
end=$4

bash "$(dirname "$0")/call_ttjj_api.sh" get_kline "$secid" "$klt" "$lmt" "$end"