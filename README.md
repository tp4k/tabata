# Tabata Interval Timer

A vanilla HTML/CSS/JS Tabata-style interval timer, installable as a Progressive Web App and fully usable offline.

## Deploy to GitHub Pages

1. Push this repository to GitHub (e.g. `git push origin main`).
2. In the repository settings, open **Pages** and enable it for the `main` branch, root (`/`) folder.
3. GitHub will publish the site at `https://<user>.github.io/<repo>/`. All asset paths in this project are relative (`./`), so the app works correctly when served from that `/<repo>/` subpath — no path rewriting needed.

## Add to Home Screen (iPhone / iPad, Safari)

1. Open the deployed site in Safari.
2. Tap the **Share** icon, then choose **Add to Home Screen**.
3. Launch the app from the home screen icon — it opens in standalone mode (no browser chrome).
4. After the first successful load, the app works fully offline.

## Offline notes

The first load of the app must happen while online so the service worker can install and precache all app assets. After that, the app is available offline.
