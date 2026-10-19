"""
Great Clips Coupon Crawler & Live Validator.

Scrapes greatclipscoupons.org and dealsfinders.com, validates redemption status
against the live Great Clips API, prunes expired offers, and completely overwrites
data/coupons.json with currently active coupons only.
"""

import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from urllib.parse import parse_qs, unquote, urlparse

import requests
from bs4 import BeautifulSoup

try:
    from scheduler import record_successful_crawl, should_crawl
except ImportError:
    from crawler.scheduler import record_successful_crawl, should_crawl

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
COUPONS_JSON_PATH = os.path.join(DATA_DIR, "coupons.json")
STATE_FILE_PATH = os.path.join(DATA_DIR, "schedule_state.json")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/118.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

AJAX_HEADERS = {
    "User-Agent": HEADERS["User-Agent"],
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
}

US_STATES_DICT = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new-hampshire": "NH", "new-jersey": "NJ", "new-mexico": "NM", "new-york": "NY",
    "north-carolina": "NC", "north-dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode-island": "RI", "south-carolina": "SC",
    "south-dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA", "west-virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY", "district-of-columbia": "DC",
}

US_STATE_CODES = set(US_STATES_DICT.values())


def extract_state_code(text: str) -> str:
    """Detects 2-letter uppercase US state code from location string."""
    if not text:
        return ""
    # 1. Comma followed by 2 letters: e.g. ", TX" or ", OH"
    comma_match = re.search(r",\s*([A-Za-z]{2})\b", text)
    if comma_match:
        cand = comma_match.group(1).upper()
        if cand in US_STATE_CODES:
            return cand

    # 2. "in AZ" or "at TX"
    in_match = re.search(r"\b(?:in|at)\s+([A-Za-z]{2})\b", text, re.IGNORECASE)
    if in_match:
        cand = in_match.group(1).upper()
        if cand in US_STATE_CODES:
            return cand

    # 3. Check full state name
    lower_text = text.lower()
    for slug, code in US_STATES_DICT.items():
        name = slug.replace("-", " ")
        if re.search(r"\b" + re.escape(name) + r"\b", lower_text):
            return code
    return ""


def extract_city(text: str) -> str:
    """Extracts city name from location string if pattern matches 'in City, ST'."""
    if not text:
        return ""
    match = re.search(r"\bin\s+([^,\n\r]+),\s*[A-Za-z]{2}", text, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return ""


def parse_expiration_date(exp_str: str) -> datetime:
    """Parses date string in MM/DD/YYYY format."""
    if not exp_str:
        return None
    match = re.search(r"(\d{2})/(\d{2})/(\d{4})", exp_str)
    if not match:
        return None
    try:
        m, d, y = int(match.group(1)), int(match.group(2)), int(match.group(3))
        return datetime(y, m, d, 23, 59, 59, tzinfo=timezone.utc)
    except Exception:
        return None


def fetch_url(session: requests.Session, url: str, timeout: int = 8) -> str:
    """Fetches text content from URL with timeout."""
    try:
        resp = session.get(url, headers=HEADERS, timeout=timeout)
        if resp.status_code == 200:
            return resp.text
    except Exception as e:
        pass
    return None


def scrape_greatclipscoupons(session: requests.Session) -> list:
    """Scrapes greatclipscoupons.org for candidate offer links."""
    start_url = "https://greatclipscoupons.org/"
    print(f"[Scraper] Scanning {start_url} ...")
    html = fetch_url(session, start_url)
    if not html:
        print("[Scraper] Warning: Failed to reach greatclipscoupons.org root.")
        return []

    soup = BeautifulSoup(html, "html.parser")
    subpages = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if "greatclipscoupons.org/great-clips" in href and href != start_url and href != f"{start_url}/":
            subpages.add(href)

    print(f"[Scraper] Found {len(subpages)} intermediate subpages on GCC.")
    candidates = {}

    def process_subpage(url):
        page_html = fetch_url(session, url)
        if not page_html:
            return []
        page_soup = BeautifulSoup(page_html, "html.parser")
        found = []
        for a_tag in page_soup.find_all("a", href=True):
            href = a_tag["href"].strip()
            if "offers.greatclips.com" in href:
                clean_url = href.split("?")[0].rstrip("/")
                code = clean_url.split("/")[-1]
                if code and len(code) >= 4:
                    found.append((code, clean_url))
        return found

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(process_subpage, url): url for url in subpages}
        for fut in as_completed(futures):
            for code, clean_url in fut.result():
                if code not in candidates:
                    candidates[code] = {
                        "code": code,
                        "url": clean_url,
                        "source": "greatclipscoupons",
                    }

    print(f"[Scraper] Extracted {len(candidates)} unique candidates from GCC.")
    return list(candidates.values())


def scrape_dealsfinders(session: requests.Session) -> list:
    """Scrapes dealsfinders.com across all state coupon directories."""
    base_url = "https://dealsfinders.com/coupons/"
    print(f"[Scraper] Scanning {base_url} ...")
    html = fetch_url(session, base_url)
    if not html:
        print("[Scraper] Warning: Failed to reach DealsFinders root.")
        return []

    soup = BeautifulSoup(html, "html.parser")
    state_pages = set()

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        try:
            parsed = urlparse(href)
            parts = [p.lower() for p in parsed.path.split("/") if p]
            if len(parts) == 2 and parts[0] == "coupons":
                slug = parts[1].replace("-coupons", "")
                if slug in US_STATES_DICT:
                    full_link = f"https://dealsfinders.com/coupons/{parts[1]}/"
                    state_pages.add((full_link, slug, US_STATES_DICT[slug]))
        except Exception:
            continue

    print(f"[Scraper] Found {len(state_pages)} state pages on DealsFinders.")
    candidates = {}

    def process_state_page(page_info):
        url, slug, state_code = page_info
        page_html = fetch_url(session, url)
        if not page_html:
            return []
        page_soup = BeautifulSoup(page_html, "html.parser")
        found = []

        for a_tag in page_soup.find_all("a", href=True):
            href = a_tag["href"].strip()
            if "offers.greatclips.com" not in href:
                continue

            try:
                parsed_href = urlparse(href)
                query_params = parse_qs(parsed_href.query)

                target_url = None
                if "target" in query_params:
                    target_url = query_params["target"][0]
                elif "offers.greatclips.com" in parsed_href.netloc:
                    target_url = f"{parsed_href.scheme}://{parsed_href.netloc}{parsed_href.path}"

                if not target_url or "offers.greatclips.com" not in target_url:
                    # Check regex match for encoded target
                    m = re.search(r"target=([^&]+)", href)
                    if m:
                        target_url = unquote(m.group(1))

                if target_url and "offers.greatclips.com" in target_url:
                    clean_url = target_url.split("?")[0].rstrip("/")
                    code = clean_url.split("/")[-1]
                    if code and len(code) >= 4:
                        loc = query_params.get("loc", [None])[0]
                        if loc:
                            loc = unquote(loc).replace("Great Clips", "").strip(", - ")

                        val = query_params.get("val", [None])[0]
                        price = None
                        if val:
                            val_clean = unquote(val).strip()
                            price_m = re.search(r"\$\d+\.?\d*", val_clean)
                            price = price_m.group(0) if price_m else val_clean

                        found.append({
                            "code": code,
                            "url": clean_url,
                            "price": price,
                            "location": loc,
                            "state": state_code,
                            "source": "dealsfinders",
                        })
            except Exception:
                continue
        return found

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(process_state_page, info): info for info in state_pages}
        for fut in as_completed(futures):
            for item in fut.result():
                code = item["code"]
                if code not in candidates:
                    candidates[code] = item
                else:
                    # Enrich existing
                    exist = candidates[code]
                    if not exist.get("location") and item.get("location"):
                        exist["location"] = item["location"]
                    if not exist.get("price") and item.get("price"):
                        exist["price"] = item["price"]
                    if not exist.get("state") and item.get("state"):
                        exist["state"] = item["state"]

    print(f"[Scraper] Extracted {len(candidates)} unique candidates from DealsFinders.")
    return list(candidates.values())


def check_redemption_status(session: requests.Session, code: str) -> bool:
    """Checks live redemption_status API for a specific Great Clips code."""
    url = f"https://offers.greatclips.com/{code}/redemption_status"
    try:
        resp = session.post(url, headers=AJAX_HEADERS, timeout=6)
        if resp.status_code == 422 or resp.status_code != 200:
            return False
        data = resp.json()
        if data.get("status_text") == "ok":
            return True
        return False
    except Exception:
        return False


def validate_and_enrich_candidate(session: requests.Session, candidate: dict) -> dict:
    """
    Validates candidate active status.
    If active, fetches details (price, terms, location, expiration, city, state).
    Returns coupon dict if active, or None if expired/invalid.
    """
    code = candidate["code"]
    url = candidate["url"]

    # Step 1: Live redemption status check
    is_active = check_redemption_status(session, code)
    if not is_active:
        return None

    # Step 2: Fetch coupon page HTML to parse details
    price = candidate.get("price") or "Discount"
    location = candidate.get("location") or "Valid at participating salons"
    state = candidate.get("state") or ""
    city = ""
    expiration = "Active"

    html = fetch_url(session, url, timeout=8)
    if html:
        soup = BeautifulSoup(html, "html.parser")
        desc_p = soup.find("p", id="description")
        if desc_p:
            desc_text = desc_p.get_text().strip()
            pm = re.search(r"\$\d+\.?\d*", desc_text)
            if pm:
                price = pm.group(0)

        terms_p = soup.find("p", id="terms_and_conditions")
        if terms_p:
            terms_text = terms_p.get_text().strip()

            exp_m = re.search(r"Expires\s+(\d{2}/\d{2}/\d{4})", terms_text, re.IGNORECASE)
            if exp_m:
                expiration = exp_m.group(1)

            loc_m = re.search(r"Valid at (.*?)(?=\.|Not valid)", terms_text, re.IGNORECASE)
            if loc_m and loc_m.group(1):
                clean_loc = loc_m.group(1).replace("Great Clips", "").strip(", - ")
                if clean_loc:
                    location = clean_loc

            if not state:
                state = extract_state_code(location + " " + terms_text)

    # Detect city from location
    city = extract_city(location)
    if not state and location:
        state = extract_state_code(location)

    # Calendar date check: Is expiration date strictly in the past?
    if expiration and expiration != "Active":
        exp_dt = parse_expiration_date(expiration)
        if exp_dt and datetime.now(timezone.utc) > exp_dt:
            # Expiration date has passed!
            return None

    return {
        "code": code,
        "price": price,
        "location": location,
        "state": state,
        "city": city,
        "expiration": expiration,
        "url": url,
        "source": candidate.get("source", "greatclipscoupons"),
    }


def run_full_crawl(output_path: str = COUPONS_JSON_PATH) -> list:
    """
    Executes full crawl across both sources, validates live active status,
    and overwrites data/coupons.json with active coupons only.
    """
    print(f"\n==========================================")
    print(f"[Crawler] Starting Great Clips Coupon Crawl")
    print(f"[Crawler] Time: {datetime.now(timezone.utc).isoformat()}")
    print(f"==========================================\n")

    session = requests.Session()

    # Step 1: Scrape both sources concurrently
    gcc_results = []
    df_results = []

    with ThreadPoolExecutor(max_workers=2) as executor:
        fut_gcc = executor.submit(scrape_greatclipscoupons, session)
        fut_df = executor.submit(scrape_dealsfinders, session)
        gcc_results = fut_gcc.result()
        df_results = fut_df.result()

    # Step 2: Merge candidates by coupon code
    candidates_map = {}
    for item in gcc_results:
        candidates_map[item["code"]] = item

    for item in df_results:
        code = item["code"]
        if code in candidates_map:
            exist = candidates_map[code]
            exist["source"] = "both"
            if not exist.get("location") and item.get("location"):
                exist["location"] = item["location"]
            if not exist.get("price") and item.get("price"):
                exist["price"] = item["price"]
            if not exist.get("state") and item.get("state"):
                exist["state"] = item["state"]
        else:
            candidates_map[code] = item

    candidates = list(candidates_map.values())
    print(f"\n[Crawler] Discovered {len(candidates)} total candidates to validate.")

    # Step 3: Validate active coupons concurrently
    active_coupons = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(validate_and_enrich_candidate, session, c): c for c in candidates}
        for fut in as_completed(futures):
            res = fut.result()
            if res:
                active_coupons.append(res)
                print(f"  [ACTIVE] {res['code']} | {res['price']} | {res['state'] or 'US'} | {res['location'][:40]}")

    # Sort active coupons: price descending or state alphabetically
    active_coupons.sort(key=lambda x: (x.get("state") or "ZZ", x.get("code")))

    print(f"\n[Crawler] Validation complete: {len(active_coupons)} ACTIVE coupons found (out of {len(candidates)} candidates).")

    # Step 4: Overwrite data/coupons.json completely (NO append / merge)
    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = {
        "lastUpdated": now_utc,
        "totalActive": len(active_coupons),
        "coupons": active_coupons,
    }

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    print(f"[Crawler] Overwrote {output_path} with {len(active_coupons)} active coupons.")

    # Step 5: Update random schedule for next crawl (3 to 7 days apart)
    record_successful_crawl(len(active_coupons), STATE_FILE_PATH)

    return active_coupons


def main():
    parser = argparse.ArgumentParser(description="Great Clips Coupon Crawler & Live Validator")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check schedule gatekeeper first. Exits cleanly if crawl is not yet due.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force execution immediately, bypassing the schedule gatekeeper.",
    )
    parser.add_argument(
        "--output",
        default=COUPONS_JSON_PATH,
        help="Path to output coupons.json file.",
    )
    args = parser.parse_args()

    if args.check and not args.force:
        can_run, reason = should_crawl(STATE_FILE_PATH, force=False)
        if not can_run:
            print(f"[Gatekeeper] {reason}")
            sys.exit(0)
        else:
            print(f"[Gatekeeper] Proceeding with crawl: {reason}")

    run_full_crawl(output_path=args.output)


if __name__ == "__main__":
    main()
