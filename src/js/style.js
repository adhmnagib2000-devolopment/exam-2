/* =========================================================
   WANDERLUST - main.js (fixed & complete)
   ========================================================= */

// =======================
// API
// =======================

const API = {
    // /all في restcountries بيقبل 10 fields بس، فبنجيب قايمة خفيفة وبعدين تفاصيل كل دولة لوحدها
    countriesList: "https://restcountries.com/v3.1/all?fields=name,cca2,flags,capital",
    countryDetails: code => `https://restcountries.com/v3.1/alpha/${code}`,
    holidays: (year, code) => `https://date.nager.at/api/v3/PublicHolidays/${year}/${code}`,
    longWeekends: (year, code) => `https://date.nager.at/api/v3/LongWeekend/${year}/${code}`,
    geocoding: city => `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
    weather: (lat, lon) =>
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m` +
        `&hourly=temperature_2m,precipitation_probability,weather_code` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max` +
        `&forecast_days=7&timezone=auto`,
    // frankfurter مش بيدعم EGP، فبنستخدم open.er-api
    currency: base => `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`,
    sun: (lat, lon, tz) =>
        `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&formatted=0&tzid=${encodeURIComponent(tz || "UTC")}`
};

// ضع مفتاح Ticketmaster هنا لو عايز تعرض الأحداث
const TICKETMASTER_API_KEY = "";

// =======================
// HELPERS
// =======================

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

const safeText = (value = "") =>
    String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));

const countrySelect = $("#global-country");
const citySelect = $("#global-city");
const yearSelect = $("#global-year");
const exploreBtn = $("#global-search-btn");
const holidaysContainer = $("#holidays-content");

let countries = [];
let selectedCountry = null;
let selectedCountryDetails = null;
let currentWeather = null;
let holidaysData = [];
let weekendsData = [];
let eventsData = [];
let currentPlanFilter = "all";

const detailsCache = {};
const ratesCache = {};
let currencySelectsReady = false;

const PLAN_TYPES = {
    holiday: "Holiday",
    event: "Event",
    longweekend: "Long Weekend"
};

// =======================
// LOCAL STORAGE
// =======================

function getTrip() {
    try {
        return JSON.parse(localStorage.getItem("trip")) || null;
    } catch {
        return null;
    }
}

function setTrip(trip) {
    localStorage.setItem("trip", JSON.stringify(trip));
}

function getPlans() {
    try {
        const data = JSON.parse(localStorage.getItem("plans"));
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function setPlans(plans) {
    localStorage.setItem("plans", JSON.stringify(plans));
    updatePlanCounters();
}

function isSaved(sourceId) {
    return getPlans().some(plan => plan.sourceId === sourceId);
}

function newId() {
    return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

// =======================
// NOTIFICATIONS
// =======================

function notify(title, text = "", icon = "success") {
    if (window.Swal) {
        Swal.fire({
            title,
            text,
            icon,
            confirmButtonColor: "#2563eb"
        });
    } else {
        alert(`${title}${text ? "\n" + text : ""}`);
    }
}

function toast(title, icon = "success") {
    if (window.Swal) {
        Swal.fire({
            toast: true,
            position: "top-end",
            icon,
            title,
            showConfirmButton: false,
            timer: 1800
        });
    }
}

// =======================
// FETCH + UI STATES
// =======================

async function fetchJSON(url) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }

    return response.json();
}

function showLoading(container, message = "Loading...") {
    if (container) {
        container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="fa-solid fa-spinner fa-spin"></i></div>
        <p>${safeText(message)}</p>
      </div>`;
    }
}

function showError(container, message = "Something went wrong. Please try again.") {
    if (container) {
        container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="fa-solid fa-circle-exclamation"></i></div>
        <p>${safeText(message)}</p>
      </div>`;
    }
}

function showNoDestination(container) {
    if (container) {
        container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="fa-solid fa-earth-americas"></i></div>
        <h3>No destination selected</h3>
        <p>Go to the Dashboard and choose a country first.</p>
      </div>`;
    }
}

// =======================
// CURRENT SELECTION
// =======================

// بيرجّع { code, countryName, city, year } أو null لو مفيش دولة مختارة
function currentSelection() {
    const code = countrySelect?.value;

    if (!code) return null;

    const country = countries.find(item => item.cca2 === code) || selectedCountry;

    return {
        code,
        countryName: country?.name?.common || code,
        city: citySelect?.value || country?.capital?.[0] || "",
        year: Number(yearSelect?.value || new Date().getFullYear())
    };
}

function getDestination() {
    return getTrip() || currentSelection();
}

// =======================
// DATE FORMAT
// =======================

function formatDate(
    dateString,
    options = { day: "numeric", month: "short", year: "numeric" }
) {
    return new Date(`${dateString}T12:00:00`).toLocaleDateString("en-US", options);
}

// =======================
// UPDATE DESTINATION UI
// =======================

function updateDestinationUI(country, city) {
    const name = country?.name?.common || "";
    const flag = country?.flags?.png || country?.flags?.svg || "";

    const flagSmall = $("#selected-country-flag");
    const countryName = $("#selected-country-name");
    const cityName = $("#selected-city-name");

    if (flagSmall) {
        if (flag) flagSmall.src = flag;
        flagSmall.alt = name;
    }

    if (countryName) countryName.textContent = name;
    if (cityName) cityName.textContent = city ? `• ${city}` : "";

    $("#selected-destination")?.classList.remove("hidden");
}

// يحدّث البادجات (العلم + الاسم) اللي فوق كل صفحة
function updateViewBadges() {
    const dest = getDestination();
    if (!dest) return;

    const country = countries.find(item => item.cca2 === dest.code);
    const flag = country?.flags?.png || "";

    $$(".view-header-selection").forEach(box => {
        const isHolidayLike = box.id === "holidays-selection" ||
            box.closest("#long-weekends-view");

        box.innerHTML = `
      <div class="current-selection-badge">
        ${flag ? `<img src="${safeText(flag)}" alt="${safeText(dest.countryName)}" class="selection-flag">` : ""}
        <span>${safeText(dest.countryName)}</span>
        ${isHolidayLike
                ? `<span class="selection-year">${safeText(dest.year)}</span>`
                : `<span class="selection-city">${dest.city ? "• " + safeText(dest.city) : ""}</span>`}
      </div>`;
    });
}

// =======================
// COUNTRIES
// =======================

// ---------- Searchable country dropdown (flag + name + code) ----------

let countryDropdown = null;

function injectDropdownStyles() {
    if ($("#ws-dropdown-styles")) return;

    const style = document.createElement("style");
    style.id = "ws-dropdown-styles";
    style.textContent = `
    .ws-dd { position: relative; width: 100%; }
    .ws-dd-trigger {
      width: 100%; display: flex; align-items: center; justify-content: space-between;
      gap: 12px; padding: 14px 16px; background: #fff; color: inherit;
      border: 1px solid #e2e8f0; border-radius: 12px; font: inherit;
      font-size: 15px; cursor: pointer; text-align: left;
    }
    .ws-dd.open .ws-dd-trigger { border-color: #1e40af; box-shadow: 0 0 0 3px rgba(30,64,175,.12); }
    .ws-dd-current { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .ws-dd-current img, .ws-dd-item img {
      width: 28px; height: 20px; object-fit: cover; border-radius: 3px; flex-shrink: 0;
      box-shadow: 0 0 0 1px rgba(0,0,0,.08);
    }
    .ws-dd-placeholder { color: #94a3b8; }
    .ws-dd-chevron { transition: transform .2s; color: #64748b; }
    .ws-dd.open .ws-dd-chevron { transform: rotate(180deg); }
    .ws-dd-panel {
      display: none; position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 60;
      background: #fff; border: 1px solid #1e40af; border-radius: 12px;
      box-shadow: 0 12px 32px rgba(15,23,42,.18); overflow: hidden;
    }
    .ws-dd.open .ws-dd-panel { display: block; }
    .ws-dd-search {
      display: flex; align-items: center; gap: 10px; margin: 12px;
      padding: 10px 14px; border: 1px solid #1e40af; border-radius: 10px; color: #64748b;
    }
    .ws-dd-search input {
      flex: 1; border: 0; outline: 0; background: transparent; font: inherit; font-size: 15px; color: #0f172a;
    }
    .ws-dd-list { max-height: 300px; overflow-y: auto; border-top: 1px solid #e2e8f0; }
    .ws-dd-item {
      display: flex; align-items: center; gap: 12px; padding: 11px 16px; cursor: pointer; font-size: 15px;
    }
    .ws-dd-item:hover { background: #f1f5f9; }
    .ws-dd-item.selected { background: #eff6ff; font-weight: 600; }
    .ws-dd-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ws-dd-code { font-size: 12px; color: #94a3b8; }
    .ws-dd-empty { padding: 20px; text-align: center; color: #94a3b8; }
  `;

    document.head.appendChild(style);
}

function buildCountryDropdown() {
    if (!countrySelect) return;

    injectDropdownStyles();

    countryDropdown?.root.remove();

    // نخلي الـ select الأصلي مخفي ونستخدمه كمصدر للقيمة
    countrySelect.style.display = "none";

    const root = document.createElement("div");
    root.className = "ws-dd";
    root.innerHTML = `
    <button type="button" class="ws-dd-trigger" aria-haspopup="listbox">
      <span class="ws-dd-current"></span>
      <i class="fa-solid fa-chevron-down ws-dd-chevron"></i>
    </button>
    <div class="ws-dd-panel">
      <div class="ws-dd-search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" placeholder="Search countries..." autocomplete="off">
      </div>
      <div class="ws-dd-list" role="listbox"></div>
    </div>`;

    countrySelect.insertAdjacentElement("afterend", root);

    const trigger = $(".ws-dd-trigger", root);
    const current = $(".ws-dd-current", root);
    const input = $(".ws-dd-search input", root);
    const list = $(".ws-dd-list", root);

    function renderList(filter = "") {
        const q = filter.trim().toLowerCase();

        const matches = countries.filter(country =>
            !q ||
            country.name.common.toLowerCase().includes(q) ||
            country.cca2.toLowerCase().includes(q)
        );

        list.innerHTML = matches.length
            ? matches.map(country => `
          <div class="ws-dd-item ${country.cca2 === countrySelect.value ? "selected" : ""}"
               data-code="${safeText(country.cca2)}" role="option">
            <img src="${safeText(country.flags?.png || "")}" alt="" loading="lazy">
            <span class="ws-dd-name">${safeText(country.name.common)}</span>
            <span class="ws-dd-code">${safeText(country.cca2)}</span>
          </div>`).join("")
            : `<div class="ws-dd-empty">No countries found</div>`;
    }

    function sync() {
        const country = countries.find(item => item.cca2 === countrySelect.value);

        current.innerHTML = country
            ? `<img src="${safeText(country.flags?.png || "")}" alt="">
         <span>${safeText(country.name.common)}</span>`
            : `<span class="ws-dd-placeholder">Select Country</span>`;
    }

    function open() {
        root.classList.add("open");
        input.value = "";
        renderList();
        input.focus();
        $(".ws-dd-item.selected", list)?.scrollIntoView({ block: "center" });
    }

    function close() {
        root.classList.remove("open");
    }

    function choose(code) {
        countrySelect.value = code;
        countrySelect.dispatchEvent(new Event("change"));
        sync();
        close();
    }

    trigger.addEventListener("click", () => {
        root.classList.contains("open") ? close() : open();
    });

    input.addEventListener("input", () => renderList(input.value));

    input.addEventListener("keydown", event => {
        if (event.key === "Escape") close();

        if (event.key === "Enter") {
            event.preventDefault();
            const first = $(".ws-dd-item", list);
            if (first) choose(first.dataset.code);
        }
    });

    list.addEventListener("click", event => {
        const item = event.target.closest(".ws-dd-item");
        if (item) choose(item.dataset.code);
    });

    document.addEventListener("click", event => {
        if (!root.contains(event.target)) close();
    });

    sync();

    countryDropdown = { root, sync };
}

function syncCountryDropdown() {
    countryDropdown?.sync();
}

async function loadCountries() {
    try {
        countries = await fetchJSON(API.countriesList);

        countries.sort((a, b) => a.name.common.localeCompare(b.name.common));

        countrySelect.innerHTML = `<option value="">Select Country</option>`;

        countries.forEach(country => {
            const option = document.createElement("option");
            option.value = country.cca2;
            option.textContent = country.name.common;
            countrySelect.appendChild(option);
        });

        buildCountryDropdown();

        const statCountries = $("#stat-countries");
        if (statCountries) statCountries.textContent = countries.length;

        // لو فيه رحلة محفوظة نرجعها، غير كده مصر
        const trip = getTrip();
        const startCode = trip?.code || "EG";
        const start = countries.find(country => country.cca2 === startCode);

        if (start) {
            countrySelect.value = start.cca2;
            selectedCountry = start;
            syncCountryDropdown();

            fillCities(start, trip?.city);

            if (trip?.year) yearSelect.value = String(trip.year);

            updateDestinationUI(start, citySelect.value);
            await renderCountryInfo(start);
            updateViewBadges();
        }
    } catch (error) {
        console.error("Countries:", error);
        notify("Countries Error", "Failed to load countries", "error");
    }
}

function fillCities(country, preferredCity) {
    const capitals = country?.capital || [];

    citySelect.innerHTML = "";

    if (!capitals.length) {
        citySelect.innerHTML = `<option value="">No city data available</option>`;
        return;
    }

    capitals.forEach(city => {
        const option = document.createElement("option");
        option.value = city;
        option.textContent = city;
        citySelect.appendChild(option);
    });

    if (preferredCity && capitals.includes(preferredCity)) {
        citySelect.value = preferredCity;
    }
}

function handleCountryChange() {
    const country = countries.find(item => item.cca2 === countrySelect.value);

    if (!country) return;

    selectedCountry = country;

    fillCities(country);
    updateDestinationUI(country, citySelect.value);
    renderCountryInfo(country);
}

// =======================
// COUNTRY INFO
// =======================

function offsetFromTimezone(tz = "UTC") {
    const match = /UTC([+-])(\d{2}):?(\d{2})?/.exec(tz);

    if (!match) return 0;

    const sign = match[1] === "-" ? -1 : 1;

    return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
}

function formatNumber(value) {
    return Number(value || 0).toLocaleString("en-US");
}

async function renderCountryInfo(country) {
    const box = $("#dashboard-country-info");

    if (!box || !country) return;

    box.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon"><i class="fa-solid fa-spinner fa-spin"></i></div>
      <p>Loading country information...</p>
    </div>`;

    try {
        let details = detailsCache[country.cca2];

        if (!details) {
            const result = await fetchJSON(API.countryDetails(country.cca2));
            details = Array.isArray(result) ? result[0] : result;
            detailsCache[country.cca2] = details;
        }

        // لو المستخدم غيّر الدولة أثناء التحميل نتجاهل النتيجة دي
        if (countrySelect.value && countrySelect.value !== country.cca2) return;

        selectedCountryDetails = details;

        const flag = details.flags?.png || details.flags?.svg || "";

        const currencies = Object.entries(details.currencies || {}).map(
            ([code, info]) =>
                `<span class="extra-tag">${safeText(info.name)} (${safeText(code)}${info.symbol ? " " + safeText(info.symbol) : ""})</span>`
        ).join("") || `<span class="extra-tag">N/A</span>`;

        const languages = Object.values(details.languages || {}).map(
            lang => `<span class="extra-tag">${safeText(lang)}</span>`
        ).join("") || `<span class="extra-tag">N/A</span>`;

        const borders = (details.borders || []).map(
            code => `<span class="extra-tag border-tag">${safeText(code)}</span>`
        ).join("") || `<span class="extra-tag">No land borders</span>`;

        const root = details.idd?.root || "";
        const suffixes = details.idd?.suffixes || [];
        const callingCode = root
            ? root + (suffixes.length === 1 ? suffixes[0] : "")
            : "N/A";

        const tz = details.timezones?.[0] || "UTC";
        const week = details.startOfWeek
            ? details.startOfWeek.charAt(0).toUpperCase() + details.startOfWeek.slice(1)
            : "N/A";
        const drive = details.car?.side
            ? details.car.side.charAt(0).toUpperCase() + details.car.side.slice(1)
            : "N/A";
        const mapUrl = details.maps?.googleMaps ||
            `https://www.google.com/maps/place/${encodeURIComponent(details.name.common)}`;

        box.dataset.timezone = tz;

        box.innerHTML = `
      <div class="dashboard-country-header">
        <img src="${safeText(flag)}" alt="${safeText(details.name.common)}" class="dashboard-country-flag">
        <div class="dashboard-country-title">
          <h3>${safeText(details.name.common)}</h3>
          <p class="official-name">${safeText(details.name.official)}</p>
          <span class="region">
            <i class="fa-solid fa-location-dot"></i>
            ${safeText(details.region || "")}${details.subregion ? " • " + safeText(details.subregion) : ""}
          </span>
        </div>
      </div>

      <div class="dashboard-local-time">
        <div class="local-time-display">
          <i class="fa-solid fa-clock"></i>
          <span class="local-time-value" id="country-local-time">--:--:--</span>
          <span class="local-time-zone">${safeText(tz)}</span>
        </div>
      </div>

      <div class="dashboard-country-grid">
        <div class="dashboard-country-detail">
          <i class="fa-solid fa-building-columns"></i>
          <span class="label">Capital</span>
          <span class="value">${safeText(details.capital?.join(", ") || "N/A")}</span>
        </div>
        <div class="dashboard-country-detail">
          <i class="fa-solid fa-users"></i>
          <span class="label">Population</span>
          <span class="value">${formatNumber(details.population)}</span>
        </div>
        <div class="dashboard-country-detail">
          <i class="fa-solid fa-ruler-combined"></i>
          <span class="label">Area</span>
          <span class="value">${formatNumber(details.area)} km²</span>
        </div>
        <div class="dashboard-country-detail">
          <i class="fa-solid fa-globe"></i>
          <span class="label">Continent</span>
          <span class="value">${safeText(details.continents?.[0] || details.region || "N/A")}</span>
        </div>
        <div class="dashboard-country-detail">
          <i class="fa-solid fa-phone"></i>
          <span class="label">Calling Code</span>
          <span class="value">${safeText(callingCode)}</span>
        </div>
        <div class="dashboard-country-detail">
          <i class="fa-solid fa-car"></i>
          <span class="label">Driving Side</span>
          <span class="value">${safeText(drive)}</span>
        </div>
        <div class="dashboard-country-detail">
          <i class="fa-solid fa-calendar-week"></i>
          <span class="label">Week Starts</span>
          <span class="value">${safeText(week)}</span>
        </div>
      </div>

      <div class="dashboard-country-extras">
        <div class="dashboard-country-extra">
          <h4><i class="fa-solid fa-coins"></i> Currency</h4>
          <div class="extra-tags">${currencies}</div>
        </div>
        <div class="dashboard-country-extra">
          <h4><i class="fa-solid fa-language"></i> Languages</h4>
          <div class="extra-tags">${languages}</div>
        </div>
        <div class="dashboard-country-extra">
          <h4><i class="fa-solid fa-map-location-dot"></i> Neighbors</h4>
          <div class="extra-tags">${borders}</div>
        </div>
      </div>

      <div class="dashboard-country-actions">
        <a href="${safeText(mapUrl)}" target="_blank" rel="noopener" class="btn-map-link">
          <i class="fa-solid fa-map"></i> View on Google Maps
        </a>
      </div>`;

        updateClock();
    } catch (error) {
        console.error("Country info:", error);
        showError(box, "Could not load country information.");
    }
}

// =======================
// SAVE TRIP (Explore)
// =======================

function saveTrip() {
    const selection = currentSelection();

    if (!selection || !selection.city || !selection.year) {
        notify(
            "Choose your destination",
            "Please select a country, city and year.",
            "warning"
        );
        return;
    }

    setTrip(selection);

    updateDestinationUI(selectedCountry, selection.city);
    updateViewBadges();
    syncCurrencyWithCountry();

    notify("Destination saved", `${selection.city}, ${selection.countryName}`);

    // نحدّث الصفحة المفتوحة حالياً + إحصائية الإجازات
    loadHolidaysPage();
}

// =======================
// NAVIGATION
// =======================

const VIEW_TITLES = {
    dashboard: ["Dashboard", "Welcome back! Ready to plan your next adventure?"],
    holidays: ["Holidays", "Explore public holidays for your destination."],
    events: ["Events", "Discover events near your destination."],
    weather: ["Weather", "Check the latest weather and forecast."],
    "long-weekends": ["Long Weekends", "Find the best dates for a short break."],
    currency: ["Currency", "Convert between currencies."],
    "sun-times": ["Sun Times", "Sunrise, sunset and daylight information."],
    "my-plans": ["My Plans", "All the trips and activities you saved."]
};

function navigateTo(viewName) {
    const target = $(`#${viewName}-view`);

    if (!target) return;

    $$(".view").forEach(view => view.classList.remove("active"));
    target.classList.add("active");

    $$(".nav-item[data-view]").forEach(link => {
        link.classList.toggle("active", link.dataset.view === viewName);
    });

    const title = $("#page-title");
    const subtitle = $("#page-subtitle");

    if (title) title.textContent = VIEW_TITLES[viewName]?.[0] || "Wanderlust";
    if (subtitle) subtitle.textContent = VIEW_TITLES[viewName]?.[1] || "";

    $("#sidebar")?.classList.remove("open");
    $("#sidebar-overlay")?.classList.add("hidden");

    const loaders = {
        holidays: loadHolidaysPage,
        events: loadEventsPage,
        weather: loadWeatherPage,
        "long-weekends": loadLongWeekends,
        currency: loadCurrencies,
        "sun-times": getSunTimes,
        "my-plans": () => displayPlans()
    };

    loaders[viewName]?.();

    window.scrollTo({ top: 0, behavior: "smooth" });
}

// =======================
// HOLIDAYS
// =======================

async function loadHolidaysPage() {
    if (!holidaysContainer) return;

    const dest = getDestination();

    if (!dest) return showNoDestination(holidaysContainer);

    const { code, year } = dest;

    showLoading(holidaysContainer, "Loading public holidays...");

    try {
        const holidays = await fetchJSON(API.holidays(year, code));

        if (!Array.isArray(holidays) || holidays.length === 0) {
            holidaysData = [];
            holidaysContainer.innerHTML = `
        <div class="empty-state">
          <p>No public holidays were found for this selection.</p>
        </div>`;
            return;
        }

        holidaysData = holidays;

        holidaysContainer.innerHTML = holidays.map((holiday, index) => {
            const date = new Date(`${holiday.date}T12:00:00`);
            const saved = isSaved(`holiday-${code}-${holiday.date}`);

            return `
        <div class="holiday-card">
          <div class="holiday-card-header">
            <div class="holiday-date-box">
              <span class="day">${date.getDate()}</span>
              <span class="month">${date.toLocaleDateString("en-US", { month: "short" })}</span>
            </div>
            <button class="holiday-action-btn save-holiday-btn" data-index="${index}" aria-label="Save holiday">
              <i class="${saved ? "fa-solid" : "fa-regular"} fa-heart"></i>
            </button>
          </div>
          <h3>${safeText(holiday.localName || holiday.name)}</h3>
          <p class="holiday-name">${safeText(holiday.name)}</p>
          <div class="holiday-card-footer">
            <span class="holiday-day-badge">
              <i class="fa-regular fa-calendar"></i>
              ${date.toLocaleDateString("en-US", { weekday: "long" })}
            </span>
            <span class="holiday-type-badge">${safeText(holiday.types?.[0] || "Public")}</span>
          </div>
        </div>`;
        }).join("");

        const stat = $("#stat-holidays");
        if (stat) stat.textContent = holidays.length;

        updateViewBadges();
    } catch (error) {
        console.error("Holidays:", error);
        showError(
            holidaysContainer,
            "Could not load holidays. Check your internet connection and try again."
        );
    }
}

function toggleHoliday(button) {
    const holiday = holidaysData[Number(button.dataset.index)];
    const dest = getDestination();

    if (!holiday || !dest) return;

    const sourceId = `holiday-${dest.code}-${holiday.date}`;
    const plans = getPlans();
    const existing = plans.findIndex(plan => plan.sourceId === sourceId);
    const icon = $("i", button);

    if (existing >= 0) {
        plans.splice(existing, 1);
        setPlans(plans);
        icon.className = "fa-regular fa-heart";
        toast("Removed from My Plans", "info");
        return;
    }

    plans.push({
        id: newId(),
        sourceId,
        title: holiday.localName || holiday.name,
        type: "holiday",
        date: holiday.date,
        country: dest.countryName,
        description: holiday.name
    });

    setPlans(plans);
    icon.className = "fa-solid fa-heart";
    toast("Holiday saved");
}

// =======================
// LONG WEEKENDS
// =======================

async function loadLongWeekends() {
    const container = $("#lw-content");

    if (!container) return;

    const dest = getDestination();

    if (!dest) return showNoDestination(container);

    const { code, year } = dest;

    showLoading(container, "Finding long weekends...");

    try {
        const weekends = await fetchJSON(API.longWeekends(year, code));

        if (!Array.isArray(weekends) || !weekends.length) {
            weekendsData = [];
            container.innerHTML = `
        <div class="empty-state">
          <p>No long weekends found for this year.</p>
        </div>`;
            return;
        }

        weekendsData = weekends;

        container.innerHTML = weekends.map((weekend, index) => {
            const saved = isSaved(`weekend-${code}-${weekend.startDate}`);

            // رسم الأيام
            const days = [];
            const cursor = new Date(`${weekend.startDate}T12:00:00`);
            const end = new Date(`${weekend.endDate}T12:00:00`);

            while (cursor <= end) {
                const isWeekend = cursor.getDay() === 0 || cursor.getDay() === 6;

                days.push(`
          <div class="lw-day ${isWeekend ? "weekend" : ""}">
            <span class="name">${cursor.toLocaleDateString("en-US", { weekday: "short" })}</span>
            <span class="num">${cursor.getDate()}</span>
          </div>`);

                cursor.setDate(cursor.getDate() + 1);
            }

            return `
        <div class="lw-card">
          <div class="lw-card-header">
            <span class="lw-badge">
              <i class="fa-solid fa-calendar-days"></i> ${weekend.dayCount} Days
            </span>
            <button class="holiday-action-btn save-weekend-btn" data-index="${index}" aria-label="Save long weekend">
              <i class="${saved ? "fa-solid" : "fa-regular"} fa-heart"></i>
            </button>
          </div>
          <h3>Long Weekend #${index + 1}</h3>
          <div class="lw-dates">
            <i class="fa-regular fa-calendar"></i>
            ${formatDate(weekend.startDate)} - ${formatDate(weekend.endDate)}
          </div>
          <div class="lw-info-box ${weekend.needBridgeDay ? "warning" : "success"}">
            <i class="fa-solid ${weekend.needBridgeDay ? "fa-info-circle" : "fa-check-circle"}"></i>
            ${weekend.needBridgeDay ? "Requires taking a bridge day off" : "No extra days off needed!"}
          </div>
          <div class="lw-days-visual">${days.join("")}</div>
        </div>`;
        }).join("");

        updateViewBadges();
    } catch (error) {
        console.error("Long weekends:", error);
        showError(container, "Could not load long weekends for this country and year.");
    }
}

function toggleWeekend(button) {
    const weekend = weekendsData[Number(button.dataset.index)];
    const dest = getDestination();

    if (!weekend || !dest) return;

    const sourceId = `weekend-${dest.code}-${weekend.startDate}`;
    const plans = getPlans();
    const existing = plans.findIndex(plan => plan.sourceId === sourceId);
    const icon = $("i", button);

    if (existing >= 0) {
        plans.splice(existing, 1);
        setPlans(plans);
        icon.className = "fa-regular fa-heart";
        toast("Removed from My Plans", "info");
        return;
    }

    plans.push({
        id: newId(),
        sourceId,
        title: `Long Weekend (${weekend.dayCount} Days)`,
        type: "longweekend",
        date: weekend.startDate,
        endDate: weekend.endDate,
        country: dest.countryName
    });

    setPlans(plans);
    icon.className = "fa-solid fa-heart";
    toast("Long weekend saved");
}

// =======================
// WEATHER
// =======================

async function getCoordinates(city) {
    const result = await fetchJSON(API.geocoding(city));

    if (!result.results?.length) {
        throw new Error("City not found");
    }

    return result.results[0];
}

function weatherDescription(code) {
    if (code === 0) return "Clear sky";
    if (code === 1) return "Mainly clear";
    if (code === 2) return "Partly cloudy";
    if (code === 3) return "Overcast";
    if ([45, 48].includes(code)) return "Fog";
    if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
    if ([95, 96, 99].includes(code)) return "Thunderstorm";
    return "Weather conditions";
}

function weatherIcon(code, isDay = 1) {
    if ([0, 1].includes(code)) return isDay ? "fa-sun" : "fa-moon";
    if ([2].includes(code)) return isDay ? "fa-cloud-sun" : "fa-cloud-moon";
    if ([3].includes(code)) return "fa-cloud";
    if ([45, 48].includes(code)) return "fa-smog";
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "fa-cloud-rain";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "fa-snowflake";
    if ([95, 96, 99].includes(code)) return "fa-cloud-bolt";
    return "fa-cloud";
}

function weatherTheme(code) {
    if ([0, 1].includes(code)) return "weather-sunny";
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) return "weather-rainy";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "weather-snowy";
    return "weather-cloudy";
}

async function loadWeatherPage() {
    const container = $("#weather-content");

    if (!container) return;

    const dest = getDestination();

    if (!dest) return showNoDestination(container);

    const city = dest.city || "Cairo";

    showLoading(container, `Loading weather for ${city}...`);

    try {
        const location = await getCoordinates(city);
        const data = await fetchJSON(API.weather(location.latitude, location.longitude));

        currentWeather = data;

        const { current, daily, hourly } = data;

        // نبدأ الساعات من الساعة الحالية
        let startIndex = hourly.time.findIndex(time => time >= current.time);
        if (startIndex < 0) startIndex = 0;

        const hourlyHTML = hourly.time
            .slice(startIndex, startIndex + 8)
            .map((time, offset) => {
                const i = startIndex + offset;
                const hour = new Date(time).toLocaleTimeString("en-US", { hour: "numeric" });

                return `
          <div class="hourly-item ${offset === 0 ? "now" : ""}">
            <span class="hourly-time">${offset === 0 ? "Now" : hour}</span>
            <div class="hourly-icon"><i class="fa-solid ${weatherIcon(hourly.weather_code[i])}"></i></div>
            <span class="hourly-temp">${Math.round(hourly.temperature_2m[i])}°</span>
          </div>`;
            }).join("");

        const dailyHTML = daily.time.map((date, i) => {
            const precip = daily.precipitation_probability_max[i] ?? 0;

            return `
        <div class="forecast-day ${i === 0 ? "today" : ""}">
          <div class="forecast-day-name">
            <span class="day-label">${i === 0 ? "Today" : new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" })}</span>
            <span class="day-date">${formatDate(date, { day: "numeric", month: "short" })}</span>
          </div>
          <div class="forecast-icon"><i class="fa-solid ${weatherIcon(daily.weather_code[i])}"></i></div>
          <div class="forecast-temps">
            <span class="temp-max">${Math.round(daily.temperature_2m_max[i])}°</span>
            <span class="temp-min">${Math.round(daily.temperature_2m_min[i])}°</span>
          </div>
          <div class="forecast-precip">
            ${precip > 0 ? `<i class="fa-solid fa-droplet"></i><span>${precip}%</span>` : ""}
          </div>
        </div>`;
        }).join("");

        container.innerHTML = `
      <div class="weather-hero-card ${weatherTheme(current.weather_code)}">
        <div class="weather-location">
          <i class="fa-solid fa-location-dot"></i>
          <span>${safeText(location.name)}${location.country ? ", " + safeText(location.country) : ""}</span>
          <span class="weather-time">${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
        </div>
        <div class="weather-hero-main">
          <div class="weather-hero-left">
            <div class="weather-hero-icon"><i class="fa-solid ${weatherIcon(current.weather_code, current.is_day)}"></i></div>
            <div class="weather-hero-temp">
              <span class="temp-value">${Math.round(current.temperature_2m)}</span>
              <span class="temp-unit">°C</span>
            </div>
          </div>
          <div class="weather-hero-right">
            <div class="weather-condition">${weatherDescription(current.weather_code)}</div>
            <div class="weather-feels">Feels like ${Math.round(current.apparent_temperature)}°C</div>
            <div class="weather-high-low">
              <span class="high"><i class="fa-solid fa-arrow-up"></i> ${Math.round(daily.temperature_2m_max[0])}°</span>
              <span class="low"><i class="fa-solid fa-arrow-down"></i> ${Math.round(daily.temperature_2m_min[0])}°</span>
            </div>
          </div>
        </div>
      </div>

      <div class="weather-details-grid">
        <div class="weather-detail-card">
          <div class="detail-icon humidity"><i class="fa-solid fa-droplet"></i></div>
          <div class="detail-info">
            <span class="detail-label">Humidity</span>
            <span class="detail-value">${current.relative_humidity_2m}%</span>
          </div>
        </div>
        <div class="weather-detail-card">
          <div class="detail-icon wind"><i class="fa-solid fa-wind"></i></div>
          <div class="detail-info">
            <span class="detail-label">Wind</span>
            <span class="detail-value">${current.wind_speed_10m} km/h</span>
          </div>
        </div>
        <div class="weather-detail-card">
          <div class="detail-icon uv"><i class="fa-solid fa-sun"></i></div>
          <div class="detail-info">
            <span class="detail-label">UV Index</span>
            <span class="detail-value">${daily.uv_index_max?.[0] != null ? Math.round(daily.uv_index_max[0]) : "N/A"}</span>
          </div>
        </div>
        <div class="weather-detail-card">
          <div class="detail-icon precip"><i class="fa-solid fa-cloud-rain"></i></div>
          <div class="detail-info">
            <span class="detail-label">Precipitation</span>
            <span class="detail-value">${daily.precipitation_probability_max?.[0] ?? 0}%</span>
          </div>
        </div>
      </div>

      <div class="weather-section">
        <h3 class="weather-section-title"><i class="fa-solid fa-clock"></i> Hourly Forecast</h3>
        <div class="hourly-scroll">${hourlyHTML}</div>
      </div>

      <div class="weather-section">
        <h3 class="weather-section-title"><i class="fa-solid fa-calendar-week"></i> 7-Day Forecast</h3>
        <div class="forecast-list">${dailyHTML}</div>
      </div>`;

        updateViewBadges();
    } catch (error) {
        console.error("Weather:", error);
        showError(container, `Could not load weather for ${city}. Try another city name.`);
    }
}

// =======================
// EVENTS
// =======================

async function loadEventsPage() {
    const container = $("#events-content");

    if (!container) return;

    const dest = getDestination();

    if (!dest) return showNoDestination(container);

    if (!TICKETMASTER_API_KEY) {
        container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="fa-solid fa-key"></i></div>
        <h3>Events API key required</h3>
        <p>
          To show live events, add your Ticketmaster Discovery API key
          to TICKETMASTER_API_KEY at the top of main.js.
        </p>
        <a href="https://developer.ticketmaster.com/" target="_blank" rel="noopener">Get an API key</a>
      </div>`;
        return;
    }

    showLoading(container, "Loading events...");

    try {
        const url =
            `https://app.ticketmaster.com/discovery/v2/events.json` +
            `?city=${encodeURIComponent(dest.city || "")}` +
            `&countryCode=${encodeURIComponent(dest.code)}` +
            `&apikey=${encodeURIComponent(TICKETMASTER_API_KEY)}&size=20`;

        const data = await fetchJSON(url);

        eventsData = data._embedded?.events || [];

        if (!eventsData.length) {
            return showError(container, "No events found for this destination.");
        }

        container.innerHTML = eventsData.map((event, index) => {
            const venue = event._embedded?.venues?.[0];
            const image = event.images?.find(img => img.width > 300)?.url || "";
            const category = event.classifications?.[0]?.segment?.name || "Event";
            const date = event.dates?.start?.localDate;
            const time = event.dates?.start?.localTime?.slice(0, 5);
            const saved = isSaved(`event-${event.id}`);

            return `
        <div class="event-card">
          <div class="event-card-image">
            ${image ? `<img src="${safeText(image)}" alt="${safeText(event.name)}" onerror="this.style.display='none'">` : ""}
            <span class="event-card-category">${safeText(category)}</span>
            <button class="event-card-save save-event-btn" data-index="${index}" aria-label="Save event">
              <i class="${saved ? "fa-solid" : "fa-regular"} fa-heart"></i>
            </button>
          </div>
          <div class="event-card-body">
            <h3>${safeText(event.name)}</h3>
            <div class="event-card-info">
              <div><i class="fa-regular fa-calendar"></i>${date ? safeText(formatDate(date)) : "Date TBA"}${time ? " at " + safeText(time) : ""}</div>
              <div><i class="fa-solid fa-location-dot"></i>${safeText(venue?.name || dest.city || "Venue TBA")}</div>
            </div>
            <div class="event-card-footer">
              <a href="${safeText(event.url || "#")}" target="_blank" rel="noopener" class="btn-buy-ticket">
                <i class="fa-solid fa-ticket"></i> Buy Tickets
              </a>
            </div>
          </div>
        </div>`;
        }).join("");
    } catch (error) {
        console.error("Events:", error);
        showError(container, "Could not load events. Check your API key and try again.");
    }
}

function toggleEvent(button) {
    const event = eventsData[Number(button.dataset.index)];
    const dest = getDestination();

    if (!event) return;

    const sourceId = `event-${event.id}`;
    const plans = getPlans();
    const existing = plans.findIndex(plan => plan.sourceId === sourceId);
    const icon = $("i", button);

    if (existing >= 0) {
        plans.splice(existing, 1);
        setPlans(plans);
        icon.className = "fa-regular fa-heart";
        toast("Removed from My Plans", "info");
        return;
    }

    plans.push({
        id: newId(),
        sourceId,
        title: event.name,
        type: "event",
        date: event.dates?.start?.localDate || "",
        country: dest?.countryName || "",
        url: event.url || ""
    });

    setPlans(plans);
    icon.className = "fa-solid fa-heart";
    toast("Event saved");
}

// =======================
// CURRENCY
// =======================

const CURRENCY_FLAGS = {
    EUR: "eu", GBP: "gb", EGP: "eg", AED: "ae",
    SAR: "sa", JPY: "jp", CAD: "ca", INR: "in",
    USD: "us"
};

function currencyName(code) {
    try {
        return new Intl.DisplayNames(["en"], { type: "currency" }).of(code) || code;
    } catch {
        return code;
    }
}

async function getRates(base) {
    const cached = ratesCache[base];

    // نخزّن النتيجة 30 دقيقة
    if (cached && Date.now() - cached.fetchedAt < 30 * 60 * 1000) {
        return cached;
    }

    const data = await fetchJSON(API.currency(base));

    if (data.result !== "success") {
        throw new Error("Exchange rates unavailable");
    }

    ratesCache[base] = {
        rates: data.rates || {},
        date: data.time_last_update_utc || "",
        fetchedAt: Date.now()
    };

    return ratesCache[base];
}

function populateCurrencySelects(rates) {
    if (currencySelectsReady) return;

    const from = $("#currency-from");
    const to = $("#currency-to");

    if (!from || !to) return;

    const prevFrom = from.value || "USD";
    const prevTo = to.value || "EGP";

    const options = Object.keys(rates)
        .sort()
        .map(code => `<option value="${code}">${code} - ${safeText(currencyName(code))}</option>`)
        .join("");

    from.innerHTML = options;
    to.innerHTML = options;

    from.value = prevFrom;
    to.value = prevTo;

    currencySelectsReady = true;
}

// بيختار عملة الدولة المختارة في خانة "To"
function syncCurrencyWithCountry() {
    const to = $("#currency-to");

    if (!to || !selectedCountryDetails || !currencySelectsReady) return;

    const code = Object.keys(selectedCountryDetails.currencies || {})[0];

    if (code && [...to.options].some(option => option.value === code)) {
        to.value = code;
    }
}

async function loadCurrencies() {
    const popular = $("#popular-currencies");
    const result = $("#currency-result");

    try {
        // أول مرة: نجيب USD عشان نملا القوايم
        if (!currencySelectsReady) {
            const first = await getRates("USD");
            populateCurrencySelects(first.rates);
            syncCurrencyWithCountry();
        }

        const base = $("#currency-from")?.value || "USD";
        const { rates } = await getRates(base);

        if (popular) {
            const codes = ["EUR", "GBP", "EGP", "AED", "SAR", "JPY", "CAD", "INR"];

            popular.innerHTML = codes.map(code => `
        <div class="popular-currency-card">
          ${CURRENCY_FLAGS[code] ? `<img src="https://flagcdn.com/w40/${CURRENCY_FLAGS[code]}.png" alt="${code}" class="flag">` : ""}
          <div class="info">
            <div class="code">${code}</div>
            <div class="name">${safeText(currencyName(code))}</div>
          </div>
          <div class="rate">${rates[code] ? Number(rates[code]).toFixed(4) : "N/A"}</div>
        </div>`).join("");
        }

        await convertCurrency();
    } catch (error) {
        console.error("Currency:", error);

        if (result) {
            result.innerHTML = `<p>Could not load exchange rates. Please try again later.</p>`;
        }
    }
}

async function convertCurrency() {
    const amount = Number($("#currency-amount")?.value || 0);
    const from = $("#currency-from")?.value || "USD";
    const to = $("#currency-to")?.value || "EGP";
    const result = $("#currency-result");

    if (!result) return;

    if (!Number.isFinite(amount) || amount < 0) {
        return notify(
            "Invalid amount",
            "Enter an amount greater than or equal to zero.",
            "warning"
        );
    }

    try {
        let rate = 1;
        let date = "";

        if (from !== to) {
            const data = await getRates(from);
            rate = data.rates[to];
            date = data.date;
        }

        if (!rate) throw new Error("Exchange rate unavailable");

        const converted = amount * rate;

        result.innerHTML = `
      <div class="conversion-display">
        <div class="conversion-from">
          <span class="amount">${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          <span class="currency-code">${safeText(from)}</span>
        </div>
        <div class="conversion-equals"><i class="fa-solid fa-equals"></i></div>
        <div class="conversion-to">
          <span class="amount">${converted.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          <span class="currency-code">${safeText(to)}</span>
        </div>
      </div>
      <div class="exchange-rate-info">
        <p>1 ${safeText(from)} = ${Number(rate).toFixed(4)} ${safeText(to)}</p>
        <small>Last updated: ${safeText(date ? new Date(date).toLocaleDateString() : new Date().toLocaleDateString())}</small>
      </div>`;
    } catch (error) {
        console.error("Convert:", error);
        result.innerHTML = `<p>Unable to convert these currencies right now.</p>`;
    }
}

function swapCurrencies() {
    const from = $("#currency-from");
    const to = $("#currency-to");

    if (!from || !to) return;

    const oldFrom = from.value;

    from.value = to.value;
    to.value = oldFrom;

    loadCurrencies();
}

// =======================
// SUN TIMES
// =======================

async function getSunTimes() {
    const container = $("#sun-times-content");

    if (!container) return;

    const dest = getDestination();

    if (!dest) return showNoDestination(container);

    const city = dest.city || "Cairo";

    showLoading(container, `Loading sun times for ${city}...`);

    try {
        const location = await getCoordinates(city);
        const tz = location.timezone || "UTC";

        const data = await fetchJSON(API.sun(location.latitude, location.longitude, tz));

        if (data.status !== "OK") {
            throw new Error("Sunrise API returned an error");
        }

        const times = data.results;

        const formatTime = value =>
            new Date(value).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: true,
                timeZone: tz
            });

        const seconds = Number(times.day_length) ||
            Math.max(0, (new Date(times.sunset) - new Date(times.sunrise)) / 1000);

        const minutes = Math.round(seconds / 60);
        const daylight = `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
        const darkMinutes = 1440 - minutes;
        const darkness = `${Math.floor(darkMinutes / 60)}h ${darkMinutes % 60}m`;
        const percent = Math.min(100, (minutes / 1440) * 100);

        const now = new Date();

        const card = (cls, icon, label, time, sub) => `
      <div class="sun-time-card ${cls}">
        <div class="icon"><i class="fa-solid ${icon}"></i></div>
        <div class="label">${label}</div>
        <div class="time">${time}</div>
        <div class="sub-label">${sub}</div>
      </div>`;

        container.innerHTML = `
      <div class="sun-main-card">
        <div class="sun-main-header">
          <div class="sun-location">
            <h2><i class="fa-solid fa-location-dot"></i> ${safeText(location.name)}</h2>
            <p>Sun times for your selected location</p>
          </div>
          <div class="sun-date-display">
            <div class="date">${now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: tz })}</div>
            <div class="day">${now.toLocaleDateString("en-US", { weekday: "long", timeZone: tz })}</div>
          </div>
        </div>

        <div class="sun-times-grid">
          ${card("dawn", "fa-moon", "Dawn", formatTime(times.civil_twilight_begin), "Civil Twilight")}
          ${card("sunrise", "fa-sun", "Sunrise", formatTime(times.sunrise), "Golden Hour Start")}
          ${card("noon", "fa-sun", "Solar Noon", formatTime(times.solar_noon), "Sun at Highest")}
          ${card("sunset", "fa-sun", "Sunset", formatTime(times.sunset), "Golden Hour End")}
          ${card("dusk", "fa-moon", "Dusk", formatTime(times.civil_twilight_end), "Civil Twilight")}
          ${card("daylight", "fa-hourglass-half", "Day Length", daylight, "Total Daylight")}
        </div>
      </div>

      <div class="day-length-card">
        <h3><i class="fa-solid fa-chart-pie"></i> Daylight Distribution</h3>
        <div class="day-progress">
          <div class="day-progress-bar">
            <div class="day-progress-fill" style="width:${percent.toFixed(1)}%"></div>
          </div>
        </div>
        <div class="day-length-stats">
          <div class="day-stat"><div class="value">${daylight}</div><div class="label">Daylight</div></div>
          <div class="day-stat"><div class="value">${percent.toFixed(1)}%</div><div class="label">of 24 Hours</div></div>
          <div class="day-stat"><div class="value">${darkness}</div><div class="label">Darkness</div></div>
        </div>
      </div>`;

        updateViewBadges();
    } catch (error) {
        console.error("Sun times:", error);
        showError(container, `Could not load sunrise and sunset for ${city}.`);
    }
}

// =======================
// MY PLANS
// =======================

function planIcon(type) {
    return {
        holiday: "fa-calendar-check",
        event: "fa-ticket",
        longweekend: "fa-umbrella-beach"
    }[type] || "fa-heart";
}

function displayPlans(filter = currentPlanFilter) {
    const container = $("#plans-content");

    if (!container) return;

    currentPlanFilter = filter;

    $$(".plan-filter").forEach(button => {
        button.classList.toggle("active", button.dataset.filter === filter);
    });

    const allPlans = getPlans();
    const plans = filter === "all"
        ? allPlans
        : allPlans.filter(plan => plan.type === filter);

    updatePlanCounters();

    if (!plans.length) {
        container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="fa-solid fa-heart-crack"></i></div>
        <h3>No Saved Plans Yet</h3>
        <p>${filter === "all"
                ? "Start exploring and save holidays, events, or long weekends you like!"
                : "No plans in this category."}</p>
        <button class="btn-primary" id="start-exploring-btn">
          <i class="fa-solid fa-compass"></i> Start Exploring
        </button>
      </div>`;
        return;
    }

    container.innerHTML = plans.map(plan => `
    <div class="plan-card">
      <div class="plan-card-content">
        <span class="holiday-type-badge">
          <i class="fa-solid ${planIcon(plan.type)}"></i>
          ${safeText(PLAN_TYPES[plan.type] || plan.type || "Plan")}
        </span>
        <h3>${safeText(plan.title || "Saved plan")}</h3>
        <p>${safeText(plan.country || "")}</p>
        <p>
          ${plan.date ? safeText(formatDate(plan.date)) : ""}
          ${plan.endDate ? " - " + safeText(formatDate(plan.endDate)) : ""}
        </p>
        ${plan.url ? `<a href="${safeText(plan.url)}" target="_blank" rel="noopener">Open details</a>` : ""}
      </div>
      <button class="delete-plan-btn" data-id="${plan.id}" aria-label="Delete plan">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>`).join("");
}

function deletePlan(id) {
    const plans = getPlans().filter(plan => String(plan.id) !== String(id));

    setPlans(plans);
    displayPlans();

    toast("Plan deleted");
}

async function clearAllPlans() {
    if (!getPlans().length) {
        return notify("Nothing to clear", "You have no saved plans.", "info");
    }

    let confirmed = true;

    if (window.Swal) {
        const result = await Swal.fire({
            title: "Clear all plans?",
            text: "This will remove every saved plan.",
            icon: "warning",
            showCancelButton: true,
            confirmButtonColor: "#dc2626",
            confirmButtonText: "Yes, clear all"
        });

        confirmed = result.isConfirmed;
    } else {
        confirmed = confirm("Clear all saved plans?");
    }

    if (!confirmed) return;

    setPlans([]);
    displayPlans();
    toast("All plans cleared");
}

function updatePlanCounters() {
    const plans = getPlans();
    const count = plans.length;

    ["#plans-count", "#stat-saved"].forEach(selector => {
        const element = $(selector);
        if (element) element.textContent = count;
    });

    $("#plans-count")?.classList.toggle("hidden", count === 0);

    const counts = {
        "#filter-all-count": count,
        "#filter-holiday-count": plans.filter(plan => plan.type === "holiday").length,
        "#filter-event-count": plans.filter(plan => plan.type === "event").length,
        "#filter-lw-count": plans.filter(plan => plan.type === "longweekend").length
    };

    Object.entries(counts).forEach(([selector, value]) => {
        const element = $(selector);
        if (element) element.textContent = value;
    });
}

// =======================
// CLOCK
// =======================

function updateClock() {
    const now = new Date();

    const dateTime = $("#current-datetime");

    if (dateTime) {
        dateTime.textContent = now.toLocaleString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    // وقت الدولة المختارة حسب الـ timezone بتاعها
    const localTime = $("#country-local-time");

    if (localTime) {
        const tz = $("#dashboard-country-info")?.dataset.timezone || "UTC";
        const shifted = new Date(now.getTime() + offsetFromTimezone(tz) * 60000);

        localTime.textContent = shifted.toLocaleTimeString("en-US", { timeZone: "UTC" });
    }
}

// =======================
// CLEAR DESTINATION
// =======================

function clearSelection() {
    localStorage.removeItem("trip");

    countrySelect.value = "";
    syncCountryDropdown();
    citySelect.innerHTML = `<option value="">Select City</option>`;

    selectedCountry = null;
    selectedCountryDetails = null;

    $("#selected-country-name").textContent = "";
    $("#selected-city-name").textContent = "";
    $("#selected-country-flag").removeAttribute("src");
    $("#selected-country-flag").alt = "";
    $("#selected-destination")?.classList.add("hidden");

    const info = $("#dashboard-country-info");

    if (info) {
        delete info.dataset.timezone;
        info.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="fa-solid fa-globe"></i></div>
        <p>Select a country to view detailed information</p>
      </div>`;
    }
}

// =======================
// BIND EVENTS
// =======================

function bindEvents() {
    countrySelect?.addEventListener("change", handleCountryChange);

    citySelect?.addEventListener("change", () => {
        updateDestinationUI(selectedCountry, citySelect.value);
    });

    exploreBtn?.addEventListener("click", saveTrip);

    // Navigation
    $$(".nav-item[data-view]").forEach(link => {
        link.addEventListener("click", event => {
            event.preventDefault();
            navigateTo(link.dataset.view);
        });
    });

    $("#clear-selection-btn")?.addEventListener("click", clearSelection);

    // Mobile menu
    $("#mobile-menu-btn")?.addEventListener("click", () => {
        $("#sidebar")?.classList.toggle("open");
        $("#sidebar-overlay")?.classList.toggle("hidden");
    });

    $("#sidebar-overlay")?.addEventListener("click", () => {
        $("#sidebar")?.classList.remove("open");
        $("#sidebar-overlay")?.classList.add("hidden");
    });

    // Currency
    $("#convert-btn")?.addEventListener("click", convertCurrency);
    $("#swap-currencies-btn")?.addEventListener("click", swapCurrencies);
    $("#currency-from")?.addEventListener("change", loadCurrencies);
    $("#currency-to")?.addEventListener("change", convertCurrency);
    $("#currency-amount")?.addEventListener("input", convertCurrency);

    // Holidays / Long weekends / Events: event delegation
    holidaysContainer?.addEventListener("click", event => {
        const button = event.target.closest(".save-holiday-btn");
        if (button) toggleHoliday(button);
    });

    $("#lw-content")?.addEventListener("click", event => {
        const button = event.target.closest(".save-weekend-btn");
        if (button) toggleWeekend(button);
    });

    $("#events-content")?.addEventListener("click", event => {
        const button = event.target.closest(".save-event-btn");
        if (button) toggleEvent(button);
    });

    // My Plans
    $$(".plan-filter").forEach(button => {
        button.addEventListener("click", () => displayPlans(button.dataset.filter));
    });

    $("#clear-all-plans-btn")?.addEventListener("click", clearAllPlans);

    $("#plans-content")?.addEventListener("click", event => {
        const deleteBtn = event.target.closest(".delete-plan-btn");

        if (deleteBtn) {
            return deletePlan(deleteBtn.dataset.id);
        }

        if (event.target.closest("#start-exploring-btn")) {
            navigateTo("dashboard");
        }
    });
}

// =======================
// INITIALIZE
// =======================

function init() {
    bindEvents();
    updateClock();
    setInterval(updateClock, 1000);
    updatePlanCounters();
    loadCountries();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
