# v1.2 DEVELOPMENT BUILD

This build disables service-worker caching on localhost and cache-busts app.js so code updates load reliably during testing.

# London Life Map

A mobile-first Google Maps web app for London with:

- Dark Google Maps basemap
- High-resolution zoom/pan
- Satellite view
- Live Google traffic overlay
- Toggleable Underground mode
- TfL Tube lines drawn as real map polylines in official line colors
- Tube line names on the map
- Multi-line interchange stations rendered as multiple colored nodes
- Nearby bus-stop integration when tapping a Tube station
- Personal London places already highlighted
- PWA-ready shell for "Add to Home Screen" once hosted over HTTPS

## 1. Google Maps key

The app asks for a Google Maps JavaScript API key on first launch and stores it locally in the browser.

Google currently requires an API key for Maps JavaScript API. For production use, enable the Maps JavaScript API in a Google Cloud project and restrict the key to the domain where you host this app.

Official setup:
https://developers.google.com/maps/documentation/javascript/get-api-key

## 2. Run on a computer

For testing, serve the folder with any simple local web server.

Python:
```bash
python -m http.server 8080
```

Then open:
http://localhost:8080

You can also open `index.html` directly, but HTTPS/HTTP hosting is recommended because PWA features and browser security behave better.

## 3. Use on a phone

The reliable setup is to put this folder on any static HTTPS host (GitHub Pages, Cloudflare Pages, Netlify, Vercel, etc.).

Once hosted:
- iPhone Safari: Share > Add to Home Screen
- Android Chrome: Menu > Add to Home screen / Install app

The project already includes a web app manifest and service worker.

## Tube data

Tube lines and stations come from Transport for London's Unified API and are cached locally for 24 hours.

The app currently uses these Tube lines:
Bakerloo, Central, Circle, District, Hammersmith & City, Jubilee, Metropolitan, Northern, Piccadilly, Victoria, Waterloo & City.

Station clicks also request nearby public bus/coach/tram stop data within 250 m.

Attribution required by TfL is displayed in the app:
"Data provided by Transport for London"

## Files

- `index.html` — app shell
- `styles.css` — responsive/mobile design
- `app.js` — Google Maps + TfL overlay logic
- `manifest.webmanifest` — PWA metadata
- `sw.js` — app-shell caching
- `icon-192.png`, `icon-512.png` — app icons
