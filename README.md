# CafTrack (personal clone)

A personal, zero-dependency web clone of [CafTrack](https://www.caftrack.app/), the caffeine tracker. It shows how much caffeine is in your body right now, forecasts how it decays, and projects your level at bedtime.

**Live app:** https://samjayf26-prog.github.io/caftrack/

## Features

- **Live caffeine level** with Low / Moderate / High status (under 50%, under 80%, 80%+ of your daily limit) and a progress bar.
- **Sleep readiness**: bedtime, time until sleep, and projected mg at bedtime versus your sleep target.
- **Set Bedtime** modal with 9 PM / 10 PM / 11 PM / 12 AM presets, custom time and live projection.
- **Add intake**: Just now, 1 hour ago, Earlier today (8:00 AM) or an exact date and time (with Today / Yesterday / N days ago shortcuts).
- **Drink database** of ~270 coffees, teas, energy drinks, sodas and other sources, plus 5 favorites and your 5 most recent drinks. Search matches name or category and highlights the match.
- **Last Call**: works backwards from your bedtime and sleep target to show the latest time you can take each of your staples (pill, mint, Ultra Energy pouch, Ultra Focus pouch), how many mg you have room for right now, and a "Last call" marker on the chart. Tap an item to make it the headline. Picking a drink in Add Intake shows what it would do to your bedtime level before you log it.
- **Daily Dose**: set the window you rely on to avoid withdrawal headaches (default 12:00 to 2:00 PM, Caffeine Pill 100 mg). The Last Call card shows whether it's due, taken or missed, the latest time in the window that still meets your sleep target (suggesting a smaller staple if it doesn't fit), and a one-tap "Log now" button. Until it's taken, every Last Call and "room right now" figure reserves space for it.
- **Wind-Down (sleep aids)**: log melatonin (0.5 to 10 mg) and magnesium; the card shows each one's timing window for your bedtime (30 to 60 min before), whether tonight's dose was on time, and a magnesium streak (nights out of the last 7). Sleep aids never count toward your caffeine level. Hide the card in Settings if you don't use it.
- **Pills, mints and pouches**: 100 mg pills, 80 mg mints and 180 mg Ultra Energy pouches are pinned to Favorites.
- **Paraxanthine tracking** (e.g. Ultra Focus pouches, 100 mg): counted toward your level and bedtime projection, marked "PX", and decaying faster than caffeine (3.1 h vs 4.1 h reference half-life, scaled by your metabolism settings). Custom entries can be caffeine or paraxanthine.
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
