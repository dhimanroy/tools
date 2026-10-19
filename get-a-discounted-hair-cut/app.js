/**
 * Great Clips Live Coupon Finder
 * Client-Side Application Logic (Zero Dependencies)
 */

(function () {
  "use strict";

  // State Management
  let allCoupons = [];
  let filteredCoupons = [];
  let activeStateFilter = "all";
  let activeSortOption = "state-asc";
  let searchQuery = "";
  let metadata = { lastUpdated: null, totalActive: 0 };
  let scheduleState = null;

  // DOM Elements
  const couponsGrid = document.getElementById("coupons-grid");
  const searchInput = document.getElementById("search-input");
  const clearSearchBtn = document.getElementById("clear-search-btn");
  const stateSelect = document.getElementById("state-select");
  const sortSelect = document.getElementById("sort-select");
  const stateChipsContainer = document.getElementById("state-chips");
  const resultsCountEl = document.getElementById("results-count");
  const totalActiveStatEl = document.getElementById("total-active-stat");
  const lastUpdatedStatEl = document.getElementById("last-updated-stat");
  const nextCrawlStatEl = document.getElementById("next-crawl-stat");
  const themeToggleBtn = document.getElementById("theme-toggle-btn");
  const themeIcon = document.getElementById("theme-icon");

  // State Dictionary for Name Resolution
  const STATE_NAMES = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
    CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
    HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
    KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
    MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
    MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
    NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
    OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
    SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
    VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
    DC: "District of Columbia", US: "Nationwide",
  };

  /**
   * Theme Management
   */
  function initTheme() {
    const savedTheme = localStorage.getItem("gc_theme") || "dark";
    document.documentElement.setAttribute("data-theme", savedTheme);
    updateThemeIcon(savedTheme);

    themeToggleBtn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("gc_theme", next);
      updateThemeIcon(next);
    });
  }

  function updateThemeIcon(theme) {
    if (!themeIcon) return;
    if (theme === "light") {
      themeIcon.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      `;
      themeToggleBtn.title = "Switch to Dark Mode";
    } else {
      themeIcon.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
      `;
      themeToggleBtn.title = "Switch to Light Mode";
    }
  }

  /**
   * Relative Time Formatting (e.g. '2 hours ago', 'in 8 days')
   */
  function formatRelativeTime(dateStr) {
    if (!dateStr) return "Just now";
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffSec = Math.floor((now - date) / 1000);

      if (diffSec < 60) return "Just now";
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
      const days = Math.floor(diffSec / 86400);
      return `${days}d ago`;
    } catch {
      return dateStr;
    }
  }

  function formatExpirationText(expStr) {
    if (!expStr || expStr === "Active") {
      return { text: "Active Verified", isUrgent: false };
    }
    const match = expStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!match) {
      return { text: expStr, isUrgent: false };
    }

    const month = parseInt(match[1], 10) - 1;
    const day = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    const expDate = new Date(year, month, day, 23, 59, 59);
    const now = new Date();

    const diffDays = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) {
      return { text: "Expires Today", isUrgent: true };
    } else if (diffDays === 1) {
      return { text: "Expires Tomorrow", isUrgent: true };
    } else if (diffDays <= 4) {
      return { text: `Expires in ${diffDays} days (${expStr})`, isUrgent: true };
    } else {
      return { text: `Expires ${expStr} (${diffDays}d left)`, isUrgent: false };
    }
  }

  /**
   * Parse Price for Sorting
   */
  function extractNumericPrice(priceStr) {
    if (!priceStr) return 999;
    const match = priceStr.match(/\$(\d+\.?\d*)/);
    if (match) return parseFloat(match[1]);
    const numMatch = priceStr.match(/\d+\.?\d*/);
    return numMatch ? parseFloat(numMatch[0]) : 999;
  }

  /**
   * Fetch Data from coupons.json and schedule_state.json
   */
  async function loadData() {
    try {
      // 1. Fetch coupons.json (using relative path so it works in any subpath or domain)
      const res = await fetch("./data/coupons.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data = await res.json();

      allCoupons = Array.isArray(data.coupons) ? data.coupons : [];
      metadata.lastUpdated = data.lastUpdated || null;
      metadata.totalActive = data.totalActive || allCoupons.length;

      // 2. Fetch schedule_state.json for next automated crawl info
      try {
        const stateRes = await fetch("./data/schedule_state.json", { cache: "no-store" });
        if (stateRes.ok) {
          scheduleState = await stateRes.json();
        }
      } catch {
        // Non-critical if schedule_state.json is missing
      }

      updateHeaderStats();
      populateStateFilters();
      applyFiltersAndSort();
    } catch (err) {
      console.error("Failed to load coupon data:", err);
      couponsGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <h3 class="empty-title">Could not load active coupons</h3>
          <p class="empty-desc">Please verify that <code>data/coupons.json</code> is available.</p>
        </div>
      `;
    }
  }

  /**
   * Update Header Stats
   */
  function updateHeaderStats() {
    if (totalActiveStatEl) {
      totalActiveStatEl.textContent = `${metadata.totalActive} Active Deals`;
    }
    if (lastUpdatedStatEl && metadata.lastUpdated) {
      const rel = formatRelativeTime(metadata.lastUpdated);
      const full = new Date(metadata.lastUpdated).toLocaleString();
      lastUpdatedStatEl.textContent = `Updated ${rel}`;
      lastUpdatedStatEl.title = `Last Crawled: ${full}`;
    }
    if (nextCrawlStatEl && scheduleState && scheduleState.next_scheduled_crawl) {
      try {
        const nextDt = new Date(scheduleState.next_scheduled_crawl);
        const nextFormatted = nextDt.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });
        nextCrawlStatEl.textContent = `Next Crawl: ~${nextFormatted}`;
        nextCrawlStatEl.title = `Scheduled: ${nextDt.toLocaleString()}`;
      } catch {
        // ignore
      }
    }
  }

  /**
   * Populate State Dropdown and Quick Chips
   */
  function populateStateFilters() {
    const stateCounts = {};
    for (const c of allCoupons) {
      const st = (c.state || "US").toUpperCase();
      stateCounts[st] = (stateCounts[st] || 0) + 1;
    }

    const sortedStates = Object.keys(stateCounts).sort();

    // Populate Dropdown
    stateSelect.innerHTML = `<option value="all">All States (${allCoupons.length})</option>`;
    for (const st of sortedStates) {
      const fullName = STATE_NAMES[st] || st;
      const opt = document.createElement("option");
      opt.value = st;
      opt.textContent = `${fullName} (${st}) - ${stateCounts[st]}`;
      stateSelect.appendChild(opt);
    }

    // Populate Top State Quick Chips
    stateChipsContainer.innerHTML = `
      <span class="chip-label">Popular:</span>
      <button class="state-chip active" data-state="all">All (${allCoupons.length})</button>
    `;

    // Sort by most active coupons first for chips
    const topStates = [...sortedStates]
      .sort((a, b) => stateCounts[b] - stateCounts[a])
      .slice(0, 8);

    for (const st of topStates) {
      const btn = document.createElement("button");
      btn.className = "state-chip";
      btn.dataset.state = st;
      btn.textContent = `${st} (${stateCounts[st]})`;
      stateChipsContainer.appendChild(btn);
    }

    // Bind Chip click handlers
    stateChipsContainer.querySelectorAll(".state-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetState = btn.dataset.state;
        activeStateFilter = targetState;
        stateSelect.value = targetState;
        updateActiveChipUI(targetState);
        applyFiltersAndSort();
      });
    });
  }

  function updateActiveChipUI(targetState) {
    stateChipsContainer.querySelectorAll(".state-chip").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.state === targetState);
    });
  }

  /**
   * Filter and Sort Logic
   */
  function applyFiltersAndSort() {
    let result = [...allCoupons];
    const q = searchQuery.trim().toLowerCase();

    // 1. State Filter
    if (activeStateFilter !== "all") {
      result = result.filter((c) => (c.state || "US").toUpperCase() === activeStateFilter.toUpperCase());
    }

    // 2. Search Query Filter
    if (q) {
      result = result.filter((c) => {
        const stateCode = (c.state || "").toLowerCase();
        const stateFullName = (STATE_NAMES[(c.state || "").toUpperCase()] || "").toLowerCase();
        const code = (c.code || "").toLowerCase();
        const location = (c.location || "").toLowerCase();
        const price = (c.price || "").toLowerCase();
        const city = (c.city || "").toLowerCase();

        // Exact or prefix 2-letter state match (e.g., "tx", "oh", "ca")
        if (q.length === 2 && stateCode === q) return true;

        // Full state name match
        if (stateFullName.includes(q)) return true;

        // Coupon code match
        if (code.includes(q)) return true;

        // City match
        if (city && city.includes(q)) return true;

        // Location text match
        if (location.includes(q)) return true;

        // Price match (e.g. "$5.00" or "5.00")
        if (price.includes(q) || price.replace("$", "").includes(q)) return true;

        return false;
      });
    }

    // 3. Sorting
    result.sort((a, b) => {
      if (activeSortOption === "lowest-price") {
        return extractNumericPrice(a.price) - extractNumericPrice(b.price);
      }
      if (activeSortOption === "highest-price") {
        return extractNumericPrice(b.price) - extractNumericPrice(a.price);
      }
      if (activeSortOption === "state-asc") {
        const stA = a.state || "ZZ";
        const stB = b.state || "ZZ";
        if (stA !== stB) return stA.localeCompare(stB);
        return extractNumericPrice(a.price) - extractNumericPrice(b.price);
      }
      if (activeSortOption === "exp-soonest") {
        const dateA = a.expiration && a.expiration !== "Active" ? new Date(a.expiration).getTime() : 9999999999999;
        const dateB = b.expiration && b.expiration !== "Active" ? new Date(b.expiration).getTime() : 9999999999999;
        return dateA - dateB;
      }
      return 0;
    });

    filteredCoupons = result;
    renderCoupons();
  }

  /**
   * Render Coupons Grid
   */
  function renderCoupons() {
    resultsCountEl.innerHTML = `Showing <strong>${filteredCoupons.length}</strong> of ${allCoupons.length} active coupons`;

    if (filteredCoupons.length === 0) {
      couponsGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">✂️</div>
          <h3 class="empty-title">No active coupons found</h3>
          <p class="empty-desc">We couldn't find any active coupons matching "${escapeHtml(searchQuery || activeStateFilter)}".</p>
          <button class="reset-filter-btn" id="reset-filters-btn">Clear Filters</button>
        </div>
      `;

      const resetBtn = document.getElementById("reset-filters-btn");
      if (resetBtn) {
        resetBtn.addEventListener("click", () => {
          searchQuery = "";
          searchInput.value = "";
          clearSearchBtn.style.display = "none";
          activeStateFilter = "all";
          stateSelect.value = "all";
          updateActiveChipUI("all");
          applyFiltersAndSort();
        });
      }
      return;
    }

    couponsGrid.innerHTML = filteredCoupons.map((coupon) => createCouponCardHtml(coupon)).join("");
    bindCardEvents();
  }

  /**
   * Generate HTML for a Single Coupon Card
   */
  function createCouponCardHtml(coupon) {
    const expInfo = formatExpirationText(coupon.expiration);
    const stateCode = (coupon.state || "US").toUpperCase();
    const stateName = STATE_NAMES[stateCode] || stateCode;

    // Format clean display location
    let displayLoc = coupon.location || "Valid at participating salons";
    if (displayLoc.startsWith("Valid at ")) {
      displayLoc = displayLoc.replace(/^Valid at\s+/i, "");
    }

    return `
      <article class="coupon-card" data-code="${escapeHtml(coupon.code)}">
        <div>
          <div class="coupon-card-top">
            <div class="price-badge-group">
              <span class="price-tag">${escapeHtml(coupon.price || "Discount")}</span>
              <span class="price-label">Haircut Offer</span>
            </div>
            <div class="card-badges">
              <span class="state-badge" title="${escapeHtml(stateName)}">${escapeHtml(stateCode)}</span>
              <span class="status-badge">
                <span class="pulse-dot"></span> Active
              </span>
            </div>
          </div>

          <div class="location-info" style="margin-top: 16px;">
            <svg class="location-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
            <div class="location-text">
              <strong>${escapeHtml(displayLoc)}</strong>
            </div>
          </div>
        </div>

        <div class="card-footer">
          <div class="expiration-info">
            <svg class="expiration-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span class="${expInfo.isUrgent ? 'exp-badge-warning' : ''}">${escapeHtml(expInfo.text)}</span>
          </div>

          <div class="code-row">
            <span class="code-text">${escapeHtml(coupon.code)}</span>
            <button class="copy-btn" data-code="${escapeHtml(coupon.code)}" title="Copy coupon code">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy</span>
            </button>
          </div>

          <a href="${escapeHtml(coupon.url)}" target="_blank" rel="noopener noreferrer" class="redeem-btn" id="redeem-${escapeHtml(coupon.code)}">
            <span>Redeem Offer</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
        </div>
      </article>
    `;
  }

  /**
   * Bind Copy Button Handlers
   */
  function bindCardEvents() {
    couponsGrid.querySelectorAll(".copy-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        const code = btn.dataset.code;
        if (!code) return;

        try {
          await navigator.clipboard.writeText(code);
          const originalHtml = btn.innerHTML;
          btn.classList.add("copied");
          btn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>Copied!</span>
          `;

          setTimeout(() => {
            btn.classList.remove("copied");
            btn.innerHTML = originalHtml;
          }, 2000);
        } catch (err) {
          console.warn("Clipboard write failed, fallback:", err);
          prompt("Copy Coupon Code:", code);
        }
      });
    });
  }

  /**
   * Search and Filter Listeners
   */
  function initEventListeners() {
    // Search input
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value;
      clearSearchBtn.style.display = searchQuery ? "block" : "none";
      applyFiltersAndSort();
    });

    // Clear search button
    clearSearchBtn.addEventListener("click", () => {
      searchQuery = "";
      searchInput.value = "";
      clearSearchBtn.style.display = "none";
      searchInput.focus();
      applyFiltersAndSort();
    });

    // State select dropdown
    stateSelect.addEventListener("change", (e) => {
      activeStateFilter = e.target.value;
      updateActiveChipUI(activeStateFilter);
      applyFiltersAndSort();
    });

    // Sort select dropdown
    sortSelect.addEventListener("change", (e) => {
      activeSortOption = e.target.value;
      applyFiltersAndSort();
    });
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Application Entry Point
  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initEventListeners();
    loadData();
  });
})();
