# Tabata Interval Timer

A vanilla HTML/CSS/JS Tabata-style interval timer, installable as a Progressive Web App and fully usable offline.

## Add to Home Screen (iPhone / iPad, Safari)

1. Open the deployed site in Safari.
2. Tap the **Share** icon, then choose **Add to Home Screen**.
3. Launch the app from the home screen icon — it opens in standalone mode (no browser chrome).
4. After the first successful load, the app works fully offline.

## Offline notes

The first load of the app must happen while online so the service worker can install and precache all app assets. After that, the app is available offline.
