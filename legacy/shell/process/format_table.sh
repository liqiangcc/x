#!/bin/bash
# format_table.sh
jq -r '.[] | [.f14, .f2, .f4, .f3, .f20, .f8, .f104, .f105, .f128, .f136] | @tsv' all_sectors.json | \
awk 'BEGIN {
    FS="\t";
    print "排名 | 板块名称 | 相关链接 | 最新价 | 涨跌额 | 涨跌幅 | 总市值 | 换手率 | 上涨家数 | 下跌家数 | 领涨股票 | 涨跌幅";
    print "---|---|---|---|---|---|---|---|---|---|---|---";
    rank = 1;
}
{
    name = $1;
    price = $2 / 10000;
    change_amount = $3 / 10000;
    change_pct = $4 / 100;
    market_cap_raw = $5;
    if (market_cap_raw >= 1000000000000) {
        market_cap = sprintf("%.3f万亿", market_cap_raw / 1000000000000);
    } else {
        market_cap = sprintf("%.0f亿", market_cap_raw / 100000000);
    }
    turnover = $6 / 100;
    rising = $7;
    falling = $8;
    leading_stock = $9;
    leading_stock_change_pct = $10 / 100;

    links = "股吧 资金流 研报";

    printf("%d | %s | %s | %.2f | %.2f | %.2f%% | %s | %.2f%% | %d | %d | %s | %.2f%%\n",
           rank, name, links, price, change_amount, change_pct, market_cap, turnover, rising, falling, leading_stock, leading_stock_change_pct);
    rank++;
}'
