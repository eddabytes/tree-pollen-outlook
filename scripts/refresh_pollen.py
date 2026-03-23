#!/usr/bin/env python3

import json
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

GRAPHQL_URL = "https://pollen.aaaai.org/graphql/public"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = PROJECT_ROOT / "data" / "pollen-latest.json"
CATEGORY_ORDER = ["TREE", "GRASS", "WEED", "MOLD"]

SOURCES = [
    {
        "label": "AAAAI pollen counts",
        "url": "https://pollen.aaaai.org/",
        "note": "Public National Allergy Bureau station counts that power the free counts-only version of this site.",
    },
    {
        "label": "AAAAI NAB data release information",
        "url": "https://allergist.aaaai.org/forms/NABDataReleaseInformation.pdf",
        "note": "AAAAI says raw NAB data is separately requested and is not released for commercial or for-profit use.",
    },
    {
        "label": "Nominatim search API docs",
        "url": "https://nominatim.org/release-docs/latest/api/Search/",
        "note": "Free-form geocoding used by the browser to turn addresses and zip codes into coordinates.",
    },
    {
        "label": "AAAAI outdoor allergen guidance",
        "url": "https://www.aaaai.org/tools-for-the-public/conditions-library/allergies/outdoor-allergens-ttr",
        "note": "Guidance on closed windows, staying in on high-count days, showering, and medication adherence.",
    },
    {
        "label": "ACAAI environmental allergy avoidance",
        "url": "https://acaai.org/allergies/management-treatment/living-with-allergies/environmental-allergy-avoidance/",
        "note": "Guidance on pollen timing, closed windows, showers after outdoor time, and clothes drying indoors.",
    },
]

STATIONS_QUERY = """
query {
  stations(limit: 1000, order: "displayCity", filter: "isOnMap = true") {
    id
    displayCity
    name
    city
    state
    postalCode
    country
    latitude
    longitude
    scaleSet {
      scales {
        category
        range1Begin
        range2Begin
        range3Begin
        range4Begin
      }
    }
    allergenCollectionSets {
      id
      date
    }
  }
}
"""

COLLECTION_QUERY = """
query ($id: ID) {
  allergenCollectionSet(id: $id) {
    id
    date
    isCommentPublic
    comment
    weatherNotes
    allergenCollections {
      value
      allergen {
        category
        name
        commonName
        family
      }
    }
  }
}
"""


def main() -> int:
    station_payload = graphql_query(STATIONS_QUERY)
    stations = station_payload.get("stations") or []
    latest_ids = {
        station["id"]: pick_latest_collection_id(station.get("allergenCollectionSets") or [])
        for station in stations
    }

    latest_counts = fetch_latest_counts(latest_ids)
    normalized_stations = []
    for station in stations:
        normalized_stations.append(normalize_station(station, latest_counts.get(station["id"])))

    payload = {
        "mode": "live",
        "source": "aaaai_nab",
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "stationCount": len(normalized_stations),
        "stations": normalized_stations,
        "sources": SOURCES,
    }

    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}")
    return 0


def graphql_query(query: str, variables: Optional[Dict[str, object]] = None) -> Dict[str, object]:
    payload = {"query": query}
    if variables:
        payload["variables"] = variables

    request = urllib.request.Request(
        GRAPHQL_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "TreePollenOutlook/1.0",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"AAAAI GraphQL request failed: {error.code} {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"AAAAI GraphQL request failed: {error.reason}") from error

    if body.get("errors"):
        messages = "; ".join(error.get("message", "Unknown error") for error in body["errors"])
        raise RuntimeError(f"AAAAI GraphQL returned errors: {messages}")

    return body.get("data") or {}


def pick_latest_collection_id(collection_sets: List[Dict[str, object]]) -> Optional[str]:
    if not collection_sets:
        return None

    latest = max(collection_sets, key=lambda item: item.get("date") or "")
    return latest.get("id")


def fetch_latest_counts(latest_ids: Dict[str, Optional[str]]) -> Dict[str, Dict[str, object]]:
    counts: Dict[str, Dict[str, object]] = {}
    station_ids = [station_id for station_id, count_id in latest_ids.items() if count_id]

    with ThreadPoolExecutor(max_workers=8) as executor:
        future_map = {
            executor.submit(graphql_query, COLLECTION_QUERY, {"id": latest_ids[station_id]}): station_id
            for station_id in station_ids
        }

        for future in as_completed(future_map):
            station_id = future_map[future]
            payload = future.result()
            counts[station_id] = payload.get("allergenCollectionSet") or {}

    return counts


def normalize_station(
    station: Dict[str, object], latest_count: Optional[Dict[str, object]]
) -> Dict[str, object]:
    scale_map = {
        scale["category"]: scale for scale in (station.get("scaleSet") or {}).get("scales", [])
    }
    short_parts = [station.get("displayCity", ""), station.get("state", "")]
    short_label = ", ".join(part for part in short_parts if part)

    normalized = {
        "id": station["id"],
        "displayCity": station.get("displayCity") or "",
        "name": station.get("name") or "",
        "city": station.get("city") or "",
        "state": station.get("state") or "",
        "postalCode": station.get("postalCode") or "",
        "country": station.get("country") or "",
        "latitude": station.get("latitude"),
        "longitude": station.get("longitude"),
        "shortLabel": short_label or station.get("displayCity") or station.get("name") or "",
        "latestCount": None,
    }

    if not latest_count:
        return normalized

    allergen_collections = latest_count.get("allergenCollections") or []
    normalized["latestCount"] = {
        "id": latest_count.get("id"),
        "date": latest_count.get("date"),
        "comment": (latest_count.get("comment") or "") if latest_count.get("isCommentPublic") else "",
        "weatherNotes": latest_count.get("weatherNotes") or "",
        "categories": {
            category.lower(): summarize_category(category, allergen_collections, scale_map.get(category))
            for category in CATEGORY_ORDER
        },
        "topAllergens": top_allergens(allergen_collections),
        "topTreeAllergens": top_allergens(allergen_collections, category_filter="TREE"),
    }
    return normalized


def summarize_category(
    category: str,
    allergen_collections: List[Dict[str, object]],
    scale: Optional[Dict[str, object]],
) -> Dict[str, object]:
    matching = [
        collection
        for collection in allergen_collections
        if (collection.get("allergen") or {}).get("category") == category
    ]
    if not matching:
        return {
            "rawValue": None,
            "level": "Not Counted",
            "severity": 0,
            "counted": False,
        }

    total = sum(int(collection.get("value") or 0) for collection in matching)
    if not scale:
        return {
            "rawValue": total,
            "level": "Unscaled",
            "severity": 0,
            "counted": True,
        }

    if total >= int(scale["range4Begin"]):
        level = "Very High"
        severity = 4
    elif total >= int(scale["range3Begin"]):
        level = "High"
        severity = 3
    elif total >= int(scale["range2Begin"]):
        level = "Moderate"
        severity = 2
    elif total > int(scale["range1Begin"]):
        level = "Low"
        severity = 1
    else:
        level = "Not Present"
        severity = 0

    return {
        "rawValue": total,
        "level": level,
        "severity": severity,
        "counted": True,
    }


def top_allergens(
    allergen_collections: List[Dict[str, object]], category_filter: Optional[str] = None
) -> List[Dict[str, object]]:
    filtered = []
    for collection in allergen_collections:
        allergen = collection.get("allergen") or {}
        category = allergen.get("category")
        value = int(collection.get("value") or 0)
        if value <= 0:
            continue
        if category_filter and category != category_filter:
            continue
        filtered.append(
            {
                "category": category,
                "value": value,
                "label": allergen.get("commonName") or allergen.get("name") or "Unknown",
                "scientificName": allergen.get("name") or "",
                "family": allergen.get("family") or "",
            }
        )

    filtered.sort(key=lambda item: item["value"], reverse=True)
    return filtered[:8]


if __name__ == "__main__":
    sys.exit(main())
