# CafTrack (personal clone)

A personal, zero-dependency web clone of [CafTrack](https://www.caftrack.app/), the caffeine tracker. It shows how much caffeine is in your body right now, forecasts how it decays, and projects your level at bedtime.

**Live app:** https://samjayf26-prog.github.io/caftrack/

## Features

- **Live caffeine level** with Low / Moderate / High status (under 50%, under 80%, 80%+ of your daily limit) and a progress bar.
- **Sleep readiness**: bedtime, time until sleep, and projected mg at bedtime versus your sleep target.
- **Set Bedtime** modal with 9 PM / 10 PM / 11 PM / 12 AM presets, custom time and live projection.
- **Add intake**: Just now, 1 hour ago, Earlier today (8:00 AM) or an exact date and time (with Today / Yesterday / N days ago shortcuts).
- **Drink database** of ~280 coffees, teas, energy drinks, sodas and other sources, plus 5 favorites and your 5 most recent drinks. Search matches name or category and highlights the match.
- **Portion consumed** slider (10 to 100%) and **custom drinks**.
- **Intake history** with 24h / 3 Days / Week / All ranges, delete with **undo**.
- **Caffeine Levels chart**: decay curve with daily-limit, sleep-target and bedtime lines, plus a tooltip (mg, status, "Intake detected", % of limit). The daily limit is editable right on the chart.
- **Settings**: metabolism rate (fast 4 h, average 5.5 h, slow 7.5 h half-life), daily limit, sleep target, special conditions (pregnancy x1.5, smoker x0.7, oral contraceptives x1.3 half-life), dark mode, About Caffeine.
- **Your data**: stored only in your browser (localStorage). Export / import a JSON backup to move between devices, or clear everything.
- **Layouts**: three-column dashboard on desktop; Home / History / Stats tabs, floating add button and bottom sheet on mobile. Deep links with `?tab=home|history|stats`.
- Installable (web app manifest), light and dark themes, keyboard accessible.

## How the model works

Each drink is treated as absorbed at the time you log it and then eliminated exponentially:

```
level(t) = sum over drinks of mg * exp(-ln(2) / halfLife * (t - timeDrunk))
```

Half-life comes from your metabolism setting, multiplied by any special-condition factors. Values are estimates, not medical advice.

## Running locally

No build step. Open `index.html` in a browser, or serve the folder with any static server. Deploys automatically with GitHub Pages from `main`.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell: header, desktop grid, mobile tabs |
| `styles.css` | Glass design tokens, layout, light and dark themes |
| `js/drinks.js` | Drink database (approximate values from public sources) |
| `js/model.js` | Half-life math, projections, status, chart sampling |
| `js/store.js` | localStorage persistence and validation |
| `js/chart.js` | SVG chart with tooltip |
| `js/app.js` | UI rendering, modals, add-intake flow, events |

Research notes and the build plan live in the linked CafTrack research doc.
