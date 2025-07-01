
db_file=mydb.db
table_name=py
csv_file=data.csv
n=$2
code=$1

bash createTable.sh $db_file $table_name 12

rm -f $csv_file

bash q.sh "$code" 106 "$n" 20500207 | jq -r ".data.klines[] + \",$code\"" > data.csv

l=$(cat data.csv | wc -l)
echo "data.csv: $l"

sqlite3 "$db_file" <<EOF
.mode csv
.import  $csv_file $table_name
EOF

