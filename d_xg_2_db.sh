
db_file=mydb.db
table_name=pd_xg
code=$1

bash createTable.sh $db_file $table_name 13


sqlite3 "$db_file" "INSERT INTO $table_name select d.*,y.c4 from pd d join py y on d.c12 = y.c12 and d.c1 > y.c1 and y.c1 >= date(d.c1,'-1 years') and y.c4 and  d.c1 = '2025-06-27' limit 1;"

echo "$1"
