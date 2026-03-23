# Tree Pollen Outlook

A static site for comparing current pollen counts near home and work using the nearest public AAAAI National Allergy Bureau station.

This pivoted version is:

- free-source and counts-only
- home/work address or zip-code driven
- green themed with light and dark mode
- deployable as a static site on GitHub Pages

## What changed

The site no longer uses a paid forecast API.

Instead:

1. A daily Python job pulls the latest public NAB station counts.
2. The site stores that station snapshot in [data/pollen-latest.json](/Users/eddie/code/tree-pollen-outlook/data/pollen-latest.json).
3. In the browser, user-entered home and work locations are geocoded with Nominatim.
4. The app finds the nearest mapped NAB station for each location and shows current counts.

## Stack

- Static HTML, CSS, and browser JavaScript
- AAAAI public GraphQL endpoint for station and current-count data
- Nominatim for free-form geocoding in the browser
- Python 3 for the daily count refresh
- GitHub Actions for refreshing the static JSON and deploying GitHub Pages

## Local preview

From this folder:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

## Data refresh

Run this locally to refresh the daily count snapshot:

```bash
python3 scripts/refresh_pollen.py
```

That writes the latest free NAB station data into [data/pollen-latest.json](/Users/eddie/code/tree-pollen-outlook/data/pollen-latest.json).

## GitHub Pages

The current static approach works well on GitHub Pages because all NAB count data is pre-fetched into JSON.

To push:

```bash
git add .
git commit -m "Pivot to free NAB counts"
git remote add origin git@github.com:YOUR-USER/tree-pollen-outlook.git
git push -u origin main
```

If `git commit` fails, set your identity first:

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
```

## Notes

- The browser geocoding step uses Nominatim’s public search endpoint. Their docs say the search API supports free-form address queries, and they note that large numbers of requests should include an email address and follow their usage policy. For light personal-site usage, this is usually fine; for heavier traffic, switch to a dedicated geocoder or self-host.
- NAB counts are observed counts from reporting stations, not forecasts and not block-level measurements.
- Count dates vary by station. The app surfaces the latest available station date on each card so users can judge staleness.

## Sources

- [AAAAI pollen counts](https://pollen.aaaai.org/)
- [AAAAI NAB data release information](https://allergist.aaaai.org/forms/NABDataReleaseInformation.pdf)
- [Nominatim search API docs](https://nominatim.org/release-docs/latest/api/Search/)
- [AAAAI outdoor allergens guidance](https://www.aaaai.org/tools-for-the-public/conditions-library/allergies/outdoor-allergens-ttr)
- [ACAAI environmental allergy avoidance](https://acaai.org/allergies/management-treatment/living-with-allergies/environmental-allergy-avoidance/)
