#!/bin/bash

# 检查是否输入足够的参数
if [ $# -lt 3 ]; then
    echo "使用方法: $0 <数据库文件名> <表名> <列数>"
    echo "例如: $0 stock_data.db stock_klines 11"
    exit 1
fi

# 获取参数
db_file=$1
table_name=$2
columns_number=$3

# 检查列数是否为数字
if ! [[ "$columns_number" =~ ^[0-9]+$ ]]; then
    echo "错误：列数必须是数字。"
    exit 1
fi

# 创建表结构
create_table_query="CREATE TABLE IF NOT EXISTS $table_name ("

# 动态生成列
for ((i=1; i<=columns_number; i++)); do
    if [ "$i" -eq 1 ] || [ "$i" -eq "$columns_number" ]; then
        create_table_query+="c$i TEXT"
    else
        #create_table_query+="c$i REAL"
	create_table_query+="c$i TEXT"
    fi
    # 如果不是最后一列，添加逗号
    if [ "$i" -lt "$columns_number" ]; then
        create_table_query+=", "
    fi
done

create_table_query+=");"

# 执行创建表的 SQL 语句
sqlite3 "$db_file" "$create_table_query"

echo "数据库和表已创建！"
echo "数据库文件: $db_file"
echo "表名称: $table_name"
echo "列数: $columns_number"
