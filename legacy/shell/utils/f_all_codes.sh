
#!/bin/bash
for i in {1..58}; do
pn=$i
curl -s "https://push2.eastmoney.com/api/qt/clist/get?np=1&fltt=1&invt=2&cb=jQuery371021136309744424342_1751191136991&fs=m%3A0%2Bt%3A6%2Cm%3A0%2Bt%3A80%2Cm%3A1%2Bt%3A2%2Cm%3A1%2Bt%3A23%2Cm%3A0%2Bt%3A81%2Bs%3A2048&fields=f12%2Cf13%2Cf14%2Cf1%2Cf2%2Cf4%2Cf3%2Cf152%2Cf5%2Cf6%2Cf7%2Cf15%2Cf18%2Cf16%2Cf17%2Cf10%2Cf8%2Cf9%2Cf23&fid=f3&pn=$pn&&pz=200po=1&dect=1&ut=fa5fd1943c7b386f172d6893dbfba10b&wbp2u=%7C0%7C0%7C0%7Cweb&_=1751191137007" \
  -H 'Accept: */*' \
  -H 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6' \
  -H 'Connection: keep-alive' \
  -b 'qgqp_b_id=bee62a3dca820a540128aba84b96b45b; websitepoptg_api_time=1751186639768; st_si=02927913921702; fullscreengg=1; fullscreengg2=1; st_asi=delete; HAList=ty-0-300059-%u4E1C%u65B9%u8D22%u5BCC%2Cty-0-002180-%u7EB3%u601D%u8FBE%2Cty-90-BK0475-%u94F6%u884C; st_pvi=76408780582403; st_sp=2024-12-08%2016%3A31%3A50; st_inirUrl=https%3A%2F%2Fcn.bing.com%2F; st_sn=51; st_psi=20250629175950373-113200301321-0816053454' \
  -H 'Referer: https://quote.eastmoney.com/center/gridlist.html' \
  -H 'Sec-Fetch-Dest: script' \
  -H 'Sec-Fetch-Mode: no-cors' \
  -H 'Sec-Fetch-Site: same-site' \
  -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0' \
  -H 'sec-ch-ua: "Not)A;Brand";v="8", "Chromium";v="138", "Microsoft Edge";v="138"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "Windows"' > jcodes

#awk -F "(" '{print $2}' jcodes | awk -F ')' '{print $1}' | jq -r '.data.diff[] | .f12 + "," + (.f13 | tostring) + "," + .f14'

awk -F "(" '{print $2}' jcodes | awk -F ')' '{print $1}' | jq -r '.data.diff' |  jq -r '.[] | [.f1, .f2, .f3, .f4, .f5, .f6, .f7, .f8, .f9, .f10, .f12, .f13, .f14, .f15, .f16, .f17, .f18, .f23, .f152] | @csv'

done
