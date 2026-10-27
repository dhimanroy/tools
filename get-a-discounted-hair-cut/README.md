# ✂️ Great Clips Live Coupon Finder

Autonomous Great Clips haircut coupon scraper and live validator designed for zero-maintenance deployment on **GitHub Pages** at `dhimanroy.github.io/tools/get-a-discounted-hair-cut`.

---

## ✨ Features

- **Autonomous Randomized Crawling**:
  - Automatically crawls and scrapes coupon deals from multiple sources (`greatclipscoupons.org` and `dealsfinders.com`).
  - **Random Schedule**: Runs at random intervals strictly between **3 and 7 days apart** at random times of day.
  - **Smart Gatekeeper**: GitHub Actions runs a heartbeat check every 6 hours; if the randomized target timestamp is not yet reached, the runner exits in 2 seconds without hitting coupon servers.
- **100% Active Coupons Only**:
  - Validates every candidate code against the live Great Clips redemption API (`POST https://offers.greatclips.com/<CODE>/redemption_status`).
  - Verifies exact expiration dates and prunes expired coupons.
  - Overwrites `data/coupons.json` completely on each run (no merging or stale data).
- **Fast, Lightweight Frontend**:
  - Zero build step, zero Node.js dependencies, pure static HTML5 / CSS3 / Vanilla JS.
  - Responsive layout for desktop and mobile.
  - Instant reactive search by state (e.g. `OH`, `TX`, `CA`, `Ohio`), city, or coupon code.
  - State filter dropdown with coupon count badges.
  - One-click **"Redeem Offer"** (opens official Great Clips page to receive code via email) & **"Copy Code"**.
  - Dark / Light mode toggle with saved preference.

---

## 📁 Repository Structure

```text
tools/
├── .github/
│   └── workflows/
│       └── deploy.yml             # Single GitHub Actions workflow at repository root
├── index.html                     # Tools directory landing page (dhimanroy.github.io/tools/)
├── styles.css                     # Minimal stylesheet
├── app.js                         # Minimal theme switcher
└── get-a-discounted-hair-cut/     # ✂️ Great Clips Live Coupon Finder
    ├── crawler/
    │   ├── crawler.py             # Multi-source scraper, validator, and JSON overwriter
    │   ├── scheduler.py           # Gatekeeper (computes random 3-7 day intervals)
    │   └── requirements.txt       # Python dependencies (requests, beautifulsoup4)
    ├── data/
    │   ├── coupons.json           # Active coupons dataset (overwritten each crawl)
    │   └── schedule_state.json    # Timestamp of last crawl & next randomized target
    ├── favicon.svg                # Vector tab & touch icon
    ├── og-banner.png              # OpenGraph 1200x630 social share banner
    ├── index.html                 # Responsive web app entry point
    ├── style.css                  # Modern CSS design system (dark/light themes)
    ├── app.js                     # Search, state filter, copy actions, UI logic
    └── README.md
```
