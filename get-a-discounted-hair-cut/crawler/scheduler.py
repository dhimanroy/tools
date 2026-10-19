"""
Schedule Gatekeeper Engine for Great Clips Coupon Scraper.

Enforces randomized crawling intervals:
- Successive crawlings must be at least 3 days apart.
- Successive crawlings must be at longest 7 days apart.
- Totally randomized execution time (random day and random hour/minute).
"""

import json
import os
import random
from datetime import datetime, timedelta, timezone

DEFAULT_STATE_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "schedule_state.json"
)

MIN_INTERVAL_DAYS = 3.0
MAX_INTERVAL_DAYS = 7.0


def get_current_utc() -> datetime:
    """Returns current UTC datetime aware object."""
    return datetime.now(timezone.utc)


def parse_iso_datetime(iso_str: str) -> datetime:
    """Parses ISO-8601 string into a timezone-aware UTC datetime."""
    if not iso_str:
        return None
    # Handle 'Z' suffix for python < 3.11 compatibility
    clean_str = iso_str.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(clean_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        # Fallback for Python 3.6 format
        try:
            from dateutil import parser
            return parser.isoparse(iso_str)
        except Exception:
            return None


def calculate_next_random_crawl(from_time: datetime = None) -> datetime:
    """
    Computes a new random crawl timestamp strictly between MIN_INTERVAL_DAYS (3)
    and MAX_INTERVAL_DAYS (7) from `from_time`, with a randomized time of day.
    """
    if from_time is None:
        from_time = get_current_utc()

    # Random duration between 3 and 7 days (expressed in seconds)
    min_seconds = int(MIN_INTERVAL_DAYS * 86400)
    max_seconds = int(MAX_INTERVAL_DAYS * 86400)
    random_seconds = random.randint(min_seconds, max_seconds)

    next_crawl = from_time + timedelta(seconds=random_seconds)
    return next_crawl


def read_schedule_state(state_file_path: str = DEFAULT_STATE_FILE) -> dict:
    """Reads the schedule state file or returns an empty default."""
    if not os.path.exists(state_file_path):
        return {
            "last_crawled_at": None,
            "next_scheduled_crawl": None,
            "interval_days": None,
            "active_coupons_found": 0,
        }
    try:
        with open(state_file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[Scheduler] Warning: Failed to read state file: {e}")
        return {
            "last_crawled_at": None,
            "next_scheduled_crawl": None,
            "interval_days": None,
            "active_coupons_found": 0,
        }


def should_crawl(state_file_path: str = DEFAULT_STATE_FILE, force: bool = False) -> (bool, str):
    """
    Evaluates whether the crawler should run now.
    Returns (should_run: bool, reason: str).
    """
    if force:
        return True, "Forced execution requested via --force flag."

    state = read_schedule_state(state_file_path)
    next_crawl_str = state.get("next_scheduled_crawl")

    # If never run before, trigger initial crawl
    if not next_crawl_str:
        return True, "No previous scheduled crawl found; triggering initial run."

    next_crawl = parse_iso_datetime(next_crawl_str)
    if not next_crawl:
        return True, "Could not parse next_scheduled_crawl timestamp; triggering recovery run."

    now = get_current_utc()
    if now >= next_crawl:
        delta = now - next_crawl
        hours_passed = delta.total_seconds() / 3600.0
        return True, f"Target scheduled crawl time reached ({next_crawl.isoformat()} was {hours_passed:.1f} hours ago)."

    remaining = next_crawl - now
    remaining_hours = remaining.total_seconds() / 3600.0
    remaining_days = remaining_hours / 24.0
    return False, (
        f"Next crawl is scheduled for {next_crawl.isoformat()} "
        f"(in {remaining_days:.2f} days / {remaining_hours:.1f} hours). Skipping."
    )


def record_successful_crawl(
    active_coupons_count: int,
    state_file_path: str = DEFAULT_STATE_FILE
) -> dict:
    """
    Updates the state file after a crawl completes:
    - Sets last_crawled_at to current UTC
    - Chooses a new random target between 3 and 7 days ahead
    - Saves the updated state JSON
    """
    now = get_current_utc()
    next_crawl = calculate_next_random_crawl(now)
    interval_days = round((next_crawl - now).total_seconds() / 86400.0, 3)

    state = {
        "last_crawled_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "next_scheduled_crawl": next_crawl.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "interval_days": interval_days,
        "active_coupons_found": active_coupons_count,
        "updated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ")
    }

    os.makedirs(os.path.dirname(os.path.abspath(state_file_path)), exist_ok=True)
    with open(state_file_path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)

    print(f"[Scheduler] State updated. Next crawl scheduled at: {state['next_scheduled_crawl']} (~{interval_days} days away)")
    return state


if __name__ == "__main__":
    import sys
    force_run = "--force" in sys.argv
    can_run, reason = should_crawl(force=force_run)
    print(f"[Scheduler Check] Run allowed: {can_run}")
    print(f"[Scheduler Check] Reason: {reason}")
