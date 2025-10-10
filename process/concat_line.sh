echo "$(cat)" | awk -v suffix="$1" '{print $0 suffix}'
