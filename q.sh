if [[ "$1" == *.* ]]; then
    secid="$1"          # 若 $1 含点号，直接赋值
else
    secid=$(bash u_code_2_full.sh "$1")  # 否则执行脚本转换
fi
#secid=$(bash u_code_2_full.sh $1)
klt=$2
lmt=$3
loc=1738771200000
end=$4
url="http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=$secid&ut=fa5fd1943c7b386f172d6893dbfba10b&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=$klt&fqt=1&end=$end&lmt=$lmt&_=$loc"

#echo $url
r=$(curl -s  $url)

echo "$r"

