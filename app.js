const DATA_URL = "./data/pollen-latest.json";

const DEFAULT_SETTINGS = {
  homeQuery: "Redwood City, CA",
  workQuery: "Mission Bay, San Francisco, CA",
};

const DEFAULT_LOCATIONS = {
  home: {
    query: "Redwood City, CA",
    label: "Redwood City, San Mateo County, California, United States",
    latitude: 37.4863239,
    longitude: -122.232523,
  },
  work: {
    query: "Mission Bay, San Francisco, CA",
    label: "Mission Bay, San Francisco, California, United States",
    latitude: 37.7712584,
    longitude: -122.3913867,
  },
};

const STORAGE_KEYS = {
  settings: "tree-pollen:counts-settings:v1",
  theme: "tree-pollen:theme:v1",
};

const CATEGORY_ORDER = ["TREE", "GRASS", "WEED", "MOLD"];
const CATEGORY_LABELS = {
  TREE: "Tree",
  GRASS: "Grass",
  WEED: "Weed",
  MOLD: "Mold",
};

const GUIDANCE_COPY =
  "These cards show the nearest mapped National Allergy Bureau station and its latest available observed count. Treat the date on each card as part of the signal, because station reporting frequency varies.";

const elements = {
  bodyRoot: document.documentElement,
  themeToggle: document.querySelector("#theme-toggle"),
  locationForm: document.querySelector("#location-form"),
  homeInput: document.querySelector("#home-input"),
  workInput: document.querySelector("#work-input"),
  refreshButton: document.querySelector("#refresh-button"),
  resetButton: document.querySelector("#reset-button"),
  formStatus: document.querySelector("#form-status"),
  locationSummary: document.querySelector("#location-summary"),
  countsCopy: document.querySelector("#counts-copy"),
  modeBadge: document.querySelector("#mode-badge"),
  refreshBadge: document.querySelector("#refresh-badge"),
  methodologyNote: document.querySelector("#methodology-note"),
  heroPanel: document.querySelector("#hero-panel"),
  summaryValue: document.querySelector("#summary-value"),
  summaryHeading: document.querySelector("#summary-heading"),
  summaryContext: document.querySelector("#summary-context"),
  summaryCopy: document.querySelector("#summary-copy"),
  compareHeadline: document.querySelector("#compare-headline"),
  compareDetail: document.querySelector("#compare-detail"),
  countsGrid: document.querySelector("#counts-grid"),
  actionList: document.querySelector("#action-list"),
  patternCopy: document.querySelector("#pattern-copy"),
  sourcesList: document.querySelector("#sources-list"),
  resultCardTemplate: document.querySelector("#result-card-template"),
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const timestampFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const appState = {
  dataset: null,
  currentResults: null,
};

init();

async function init() {
  initializeTheme();
  attachEventListeners();
  fillForm(loadSavedSettings());

  try {
    appState.dataset = await loadDataset();
  } catch (error) {
    renderFatalError(error.message);
    return;
  }

  renderDatasetMeta(appState.dataset);
  renderSources(appState.dataset.sources || []);
  elements.patternCopy.textContent = GUIDANCE_COPY;

  await refreshForCurrentInputs({ allowDefaultFallback: true, initial: true });
}

function attachEventListeners() {
  elements.themeToggle.addEventListener("click", toggleTheme);
  elements.locationForm.addEventListener("submit", handleFormSubmit);
  elements.resetButton.addEventListener("click", handleResetClick);
}

async function handleFormSubmit(event) {
  event.preventDefault();
  saveSettings(readSettingsFromForm());
  await refreshForCurrentInputs({ allowDefaultFallback: false, initial: false });
}

async function handleResetClick() {
  fillForm(DEFAULT_SETTINGS);
  saveSettings(DEFAULT_SETTINGS);
  await refreshForCurrentInputs({ allowDefaultFallback: true, initial: false });
}

async function refreshForCurrentInputs({ allowDefaultFallback, initial }) {
  setLoading(true);
  setFormStatus(initial ? "Locating default places..." : "Geocoding locations...", "info");

  try {
    const settings = readSettingsFromForm();
    const resolvedLocations = await Promise.all([
      resolveLocation(settings.homeQuery, DEFAULT_LOCATIONS.home, allowDefaultFallback),
      resolveLocation(settings.workQuery, DEFAULT_LOCATIONS.work, allowDefaultFallback),
    ]);

    const results = [
      buildResult("Home", settings.homeQuery, resolvedLocations[0], appState.dataset.stations),
      buildResult("Work", settings.workQuery, resolvedLocations[1], appState.dataset.stations),
    ];

    appState.currentResults = results;
    renderResults(appState.dataset, results);
    setFormStatus("Nearest current-count stations updated.", "success");
  } catch (error) {
    if (appState.currentResults) {
      setFormStatus(error.message, "error");
    } else {
      renderFatalError(error.message);
    }
  } finally {
    setLoading(false);
  }
}

async function loadDataset() {
  const response = await fetch(DATA_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to load station-count data (${response.status}).`);
  }

  return response.json();
}

async function resolveLocation(query, fallback, allowFallback) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error("Both home and work locations need an address or zip code.");
  }

  try {
    return await geocodeLocation(trimmedQuery);
  } catch (error) {
    if (allowFallback && trimmedQuery.toLowerCase() === fallback.query.toLowerCase()) {
      return fallback;
    }

    throw error;
  }
}

async function geocodeLocation(query) {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "1",
    addressdetails: "1",
  });

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    {
      headers: {
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Location lookup failed for "${query}" (${response.status}).`);
  }

  const matches = await response.json();
  if (!Array.isArray(matches) || matches.length === 0) {
    throw new Error(`No location match was found for "${query}".`);
  }

  const match = matches[0];
  return {
    query,
    label: match.display_name,
    latitude: Number(match.lat),
    longitude: Number(match.lon),
  };
}

function buildResult(role, query, location, stations) {
  const station = findNearestStation(location, stations);
  if (!station || !station.latestCount) {
    throw new Error(`No current-count station data is available near ${location.label}.`);
  }

  const distanceMiles = haversineMiles(
    location.latitude,
    location.longitude,
    station.latitude,
    station.longitude
  );
  const categories = station.latestCount.categories || {};
  const tree = categories.tree || emptyCategory();
  const grass = categories.grass || emptyCategory();
  const weed = categories.weed || emptyCategory();
  const mold = categories.mold || emptyCategory();
  const daysOld = dayDifferenceFromToday(station.latestCount.date);
  const note = buildStationNote(station, distanceMiles, daysOld);

  return {
    role,
    query,
    location,
    station,
    distanceMiles,
    tree,
    grass,
    weed,
    mold,
    topTreeAllergens: station.latestCount.topTreeAllergens || [],
    countDate: station.latestCount.date,
    daysOld,
    note,
  };
}

function renderResults(dataset, results) {
  renderDatasetMeta(dataset);
  renderHero(results);
  renderCountCards(results);
  renderActionPlan(results);
  elements.countsCopy.textContent = buildCountsCopy(results);
  elements.locationSummary.textContent = buildLocationSummary(results);
  elements.methodologyNote.textContent =
    "Each card uses the nearest mapped NAB station and its latest available observed count. Station dates can vary, especially outside peak pollen season.";
}

function renderDatasetMeta(dataset) {
  elements.modeBadge.className = `badge ${dataset.mode === "live" ? "badge-live" : "badge-demo"}`;
  elements.modeBadge.textContent =
    dataset.mode === "live" ? "Free NAB count data" : "Bundled NAB snapshot";

  const fetchedAt = new Date(dataset.fetchedAt);
  const ageHours = (Date.now() - fetchedAt.getTime()) / 36e5;
  const stale = Number.isFinite(ageHours) && ageHours > 36;
  elements.refreshBadge.className = `badge badge-subtle ${stale ? "badge-stale" : ""}`.trim();
  elements.refreshBadge.textContent = `Snapshot updated · ${timestampFormatter.format(fetchedAt)}`;
}

function renderHero(results) {
  const comparison = buildComparison(results);
  const worst = comparison.worst;

  elements.heroPanel.className = `panel hero-panel ${severityClass(worst.tree.severity)}`;
  elements.summaryValue.textContent = formatCategoryValue(worst.tree.rawValue);
  elements.summaryHeading.textContent = `${worst.tree.level} Tree`;
  elements.summaryContext.textContent = `${worst.role} · ${worst.station.shortLabel} · ${formatCountDate(
    worst.countDate
  )}`;
  elements.summaryCopy.textContent = comparison.summaryCopy;
  elements.compareHeadline.textContent = comparison.headline;
  elements.compareDetail.textContent = comparison.detail;
}

function renderCountCards(results) {
  elements.countsGrid.innerHTML = "";

  results.forEach((result) => {
    const fragment = elements.resultCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".result-card");
    card.className = `result-card panel ${severityClass(result.tree.severity)}`;

    fragment.querySelector(".card-kicker").textContent = result.role;
    fragment.querySelector(".card-title").textContent = shortLocationLabel(result.location.label);
    fragment.querySelector(".day-chip").textContent = formatMiles(result.distanceMiles);
    fragment.querySelector(".resolved-line").textContent = result.location.label;
    fragment.querySelector(
      ".station-line"
    ).textContent = `Nearest NAB station: ${result.station.shortLabel} · ${result.station.name}`;
    fragment.querySelector(".card-score-value").textContent = formatCategoryValue(
      result.tree.rawValue
    );
    fragment.querySelector(".card-category").textContent = `Tree · ${result.tree.level}`;
    fragment.querySelector(".card-driver").textContent = `Latest count ${formatCountDate(
      result.countDate
    )}`;
    fragment.querySelector(".card-description").textContent = result.note;
    fragment.querySelector(".grass-reading").textContent = formatCategorySummary(result.grass);
    fragment.querySelector(".weed-reading").textContent = formatCategorySummary(result.weed);
    fragment.querySelector(".mold-reading").textContent = formatCategorySummary(result.mold);
    fragment.querySelector(".age-reading").textContent = formatAge(result.daysOld);

    const allergenList = fragment.querySelector(".top-allergen-list");
    if (result.topTreeAllergens.length === 0) {
      const item = document.createElement("li");
      item.textContent =
        result.tree.counted === false
          ? "Tree pollen was not counted in the latest station report."
          : "No tree pollen was recorded in the latest station report.";
      allergenList.append(item);
    } else {
      result.topTreeAllergens.slice(0, 4).forEach((allergen) => {
        const item = document.createElement("li");
        item.textContent = `${allergen.label} · ${allergen.value}`;
        allergenList.append(item);
      });
    }

    elements.countsGrid.append(fragment);
  });
}

function renderActionPlan(results) {
  const worst = buildComparison(results).worst;
  const actions = [
    "Use the date on each card. NAB counts are observed counts and can be older than the current day during quieter periods.",
    "Keep home and car windows closed, and use recirculated air when counts are elevated.",
    "After longer outdoor stretches, shower, wash your hair, and change clothes before settling in.",
  ];

  if (worst.tree.severity >= 1) {
    actions.push("Skip drying clothes or bedding outside, since they pick up pollen fast.");
  }

  if (worst.tree.severity >= 2) {
    actions.push("Move walks, workouts, and longer outdoor breaks indoors when you can.");
  }

  if (worst.tree.severity >= 3) {
    actions.push(
      "If long outdoor exposure is unavoidable, a well-fitted N95-style mask can cut inhaled pollen."
    );
  }

  if (worst.distanceMiles > 25) {
    actions.push(
      "Your nearest reporting station is fairly far away, so treat the count as a regional signal rather than a street-level measurement."
    );
  }

  if (worst.daysOld > 2) {
    actions.push(
      "The nearest-station tree count is a few days old, so combine it with your own symptom pattern before making bigger plans."
    );
  }

  elements.actionList.innerHTML = "";
  dedupe(actions)
    .slice(0, 6)
    .forEach((action) => {
      const item = document.createElement("li");
      item.textContent = action;
      elements.actionList.append(item);
    });
}

function renderSources(sources) {
  elements.sourcesList.innerHTML = "";

  sources.forEach((source) => {
    const link = document.createElement("a");
    link.className = "source-link";
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.innerHTML = `<strong>${escapeHtml(source.label)}</strong><span>${escapeHtml(source.note)}</span>`;
    elements.sourcesList.append(link);
  });
}

function renderFatalError(message) {
  document.title = "Tree Pollen Outlook | Error";
  elements.heroPanel.className = "panel hero-panel severity-5";
  elements.modeBadge.className = "badge badge-stale";
  elements.modeBadge.textContent = "Counts unavailable";
  elements.refreshBadge.className = "badge badge-subtle badge-stale";
  elements.refreshBadge.textContent = "No usable data";
  elements.methodologyNote.textContent = "The site could not load the NAB station-count dataset.";
  elements.summaryValue.textContent = "!";
  elements.summaryHeading.textContent = "Load error";
  elements.summaryContext.textContent = "Check the data file or rerun the refresh script.";
  elements.summaryCopy.textContent = message;
  elements.compareHeadline.textContent = "No count comparison";
  elements.compareDetail.textContent =
    "Once the daily NAB count snapshot is available, the site will render normally.";
  elements.countsCopy.textContent = "Restore the data file or rerun the refresh script.";
  elements.countsGrid.innerHTML = "";
  elements.actionList.innerHTML = "<li>Restore the dataset or rerun the refresh script.</li>";
  elements.patternCopy.textContent = GUIDANCE_COPY;
  elements.sourcesList.innerHTML = "";
  setFormStatus(message, "error");
}

function buildComparison(results) {
  const sorted = results.slice().sort(compareTreeResults);
  const worst = sorted[0];
  const other = sorted[1];
  const sameStation = worst.station.id === other.station.id;
  const sameSeverity = worst.tree.severity === other.tree.severity;
  const sameValue = numericValue(worst.tree.rawValue) === numericValue(other.tree.rawValue);

  let headline = "";
  let detail = "";
  let summaryCopy = "";

  if (sameStation) {
    headline = "Same nearby station";
    detail =
      "Home and work both resolve to the same reporting station, so the current count signal is effectively shared.";
    summaryCopy =
      "The same nearest NAB station is driving both locations, so today’s tree picture is basically the same for home and work.";
  } else if (sameSeverity && sameValue) {
    headline = "Very similar right now";
    detail = `${results[0].role} and ${results[1].role} are landing on nearly identical latest tree counts.`;
    summaryCopy =
      "Home and work are coming in at almost the same tree count level based on their nearest stations.";
  } else {
    headline = `${worst.role} is running higher`;
    detail = `${worst.role} shows ${formatCategorySummary(
      worst.tree
    )} for tree pollen at ${worst.station.shortLabel}, versus ${formatCategorySummary(
      other.tree
    )} at ${other.station.shortLabel}.`;
    summaryCopy = `The higher current tree signal is near ${worst.role.toLowerCase()}, based on the nearest available NAB station count.`;
  }

  return { worst, headline, detail, summaryCopy };
}

function buildCountsCopy(results) {
  if (results[0].station.id === results[1].station.id) {
    return "Both locations resolve to the same nearest reporting station, so the current counts are shared.";
  }

  return "Each card shows the nearest reporting station and the station’s latest available observed count.";
}

function buildLocationSummary(results) {
  return `${results[0].role} resolves to ${results[0].location.label}. ${results[1].role} resolves to ${results[1].location.label}.`;
}

function buildStationNote(station, distanceMiles, daysOld) {
  const notes = [];

  if (station.latestCount.weatherNotes) {
    notes.push(`Weather note: ${station.latestCount.weatherNotes}`);
  } else if (station.latestCount.comment) {
    notes.push(`Station note: ${station.latestCount.comment}`);
  }

  if (daysOld > 0) {
    notes.push(`Latest available count is ${formatAge(daysOld)}.`);
  } else {
    notes.push("Latest available count is current for today.");
  }

  if (distanceMiles > 25) {
    notes.push("This nearest station is fairly far away, so treat the count as regional.");
  }

  return notes.join(" ");
}

function findNearestStation(location, stations) {
  const nearest = stations.reduce((best, station) => {
    if (!station.latestCount) {
      return best;
    }

    const distance = haversineMiles(
      location.latitude,
      location.longitude,
      station.latitude,
      station.longitude
    );

    if (!best || distance < best.distance) {
      return { station, distance };
    }

    return best;
  }, null);

  return nearest ? nearest.station : null;
}

function compareTreeResults(left, right) {
  if (left.tree.severity !== right.tree.severity) {
    return right.tree.severity - left.tree.severity;
  }

  if (numericValue(left.tree.rawValue) !== numericValue(right.tree.rawValue)) {
    return numericValue(right.tree.rawValue) - numericValue(left.tree.rawValue);
  }

  return left.distanceMiles - right.distanceMiles;
}

function formatCategorySummary(category) {
  if (category.rawValue === null) {
    return category.level;
  }

  return `${category.rawValue} · ${category.level}`;
}

function formatCategoryValue(value) {
  return value === null ? "--" : value;
}

function formatAge(daysOld) {
  if (daysOld <= 0) {
    return "Today";
  }

  if (daysOld === 1) {
    return "1 day old";
  }

  return `${daysOld} days old`;
}

function formatCountDate(dateString) {
  return dateFormatter.format(new Date(`${dateString}T12:00:00Z`));
}

function formatMiles(distanceMiles) {
  return `${distanceMiles.toFixed(distanceMiles < 10 ? 1 : 0)} mi`;
}

function shortLocationLabel(label) {
  const parts = String(label)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.slice(0, 2).join(", ") || label;
}

function severityClass(severity) {
  const safe = Math.max(0, Math.min(5, Number(severity) || 0));
  return `severity-${safe}`;
}

function emptyCategory() {
  return {
    rawValue: null,
    level: "Not Counted",
    severity: 0,
    counted: false,
  };
}

function numericValue(value) {
  return value === null ? -1 : Number(value);
}

function dayDifferenceFromToday(dateString) {
  const today = new Date();
  const currentUtcMidnight = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );
  const countDate = new Date(`${dateString}T00:00:00Z`);
  const countUtcMidnight = Date.UTC(
    countDate.getUTCFullYear(),
    countDate.getUTCMonth(),
    countDate.getUTCDate()
  );
  return Math.max(0, Math.round((currentUtcMidnight - countUtcMidnight) / 86400000));
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 3958.7613 * c;
}

function readSettingsFromForm() {
  return {
    homeQuery: elements.homeInput.value.trim() || DEFAULT_SETTINGS.homeQuery,
    workQuery: elements.workInput.value.trim() || DEFAULT_SETTINGS.workQuery,
  };
}

function fillForm(settings) {
  elements.homeInput.value = settings.homeQuery;
  elements.workInput.value = settings.workQuery;
}

function loadSavedSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || "{}");
    return {
      homeQuery: parsed.homeQuery || DEFAULT_SETTINGS.homeQuery,
      workQuery: parsed.workQuery || DEFAULT_SETTINGS.workQuery,
    };
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
}

function setLoading(isLoading) {
  elements.refreshButton.disabled = isLoading;
  elements.resetButton.disabled = isLoading;
  elements.themeToggle.disabled = isLoading;
  elements.refreshButton.textContent = isLoading ? "Updating..." : "Update counts";
}

function setFormStatus(message, tone) {
  elements.formStatus.className = `form-status status-${tone}`;
  elements.formStatus.textContent = message;
}

function initializeTheme() {
  const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
  const preferredDark =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(savedTheme || (preferredDark ? "dark" : "light"));
}

function toggleTheme() {
  const nextTheme = elements.bodyRoot.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  localStorage.setItem(STORAGE_KEYS.theme, nextTheme);
}

function applyTheme(theme) {
  elements.bodyRoot.dataset.theme = theme;
  elements.themeToggle.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  elements.themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || seen.has(item)) {
      return false;
    }

    seen.add(item);
    return true;
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
