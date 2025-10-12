import sys
import json
import re
from urllib.request import urlopen, Request

def get_etf_details(fund_code):
    url = f"https://fund.eastmoney.com/{fund_code}.html"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0'
    }
    req = Request(url, headers=headers)
    try:
        with urlopen(req) as response:
            # Use latin-1 to avoid decoding errors on weird characters, then re-encode to utf-8
            html = response.read().decode('latin-1')
            html = html.encode('latin-1').decode('utf-8', errors='ignore')
    except Exception as e:
        print(json.dumps({"error": f"Failed to fetch URL: {e}"}), file=sys.stderr)
        return None

    data = {}

    # Extract name and code from title
    match = re.search(r'<title>(.*)\((\d{6})\).*</title>', html)
    if match:
        data['name'] = match.group(1).strip()
        data['code'] = match.group(2).strip()
    else:
        data['name'] = ''
        data['code'] = fund_code

    # Extract scale
    match = re.search(r'规模</a>：(.*?)亿元', html)
    if match:
        data['scale'] = match.group(1).strip()
    else:
        data['scale'] = ''

    # Extract establishment date
    match = re.search(r'成 立 日</span>：(.*?)</td>', html)
    if match:
        data['establishment_date'] = match.group(1).strip()
    else:
        data['establishment_date'] = ''

    # Extract type
    match = re.search(r'类型：<a .*?>(.*?)</a>', html)
    if match:
        data['type'] = match.group(1).strip()
    else:
        data['type'] = ''

    # Extract fund manager
    match = re.search(r'基金经理：<a .*?>(.*?)</a>(.*?)</td>', html)
    if match:
        manager_name = match.group(1).strip()
        other_managers = match.group(2).strip()
        data['fund_manager'] = f"{manager_name}{other_managers}"
    else:
        data['fund_manager'] = ''

    # Extract management company
    match = re.search(r'管 理 人</span>：<a .*?>(.*?)</a>', html)
    if match:
        data['management_company'] = match.group(1).strip()
    else:
        data['management_company'] = ''

    # Extract fund rating
    match = re.search(r'<div class="jjpj">(.*?)</div>', html)
    if match:
        data['fund_rating'] = match.group(1).strip()
    else:
        data['fund_rating'] = ''

    return data

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 parse_etf_details.py <fund_code>", file=sys.stderr)
        sys.exit(1)
    
    fund_code = sys.argv[1]
    details = get_etf_details(fund_code)
    if details:
        print(json.dumps(details, ensure_ascii=False, indent=2))
