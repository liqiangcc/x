
bash u_code_full.sh  | while IFS= read -r line; do
    bash f_y_2_db.sh "$line" "$1"
    sleep $(shuf -i 5-10 -n 1)
    bash f_d_2_db.sh "$line" "$1"
    sleep $(shuf -i 5-10 -n 1)
    echo "codes: $line $1"
done
