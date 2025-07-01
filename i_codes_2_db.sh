
db_file=mydb.db
table_name=codes
csv_file=all_codes.csv

bash createTable.sh $db_file $table_name 19

sqlite3 "$db_file" <<EOF
.mode csv
.import  $csv_file $table_name
EOF

