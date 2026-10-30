# LifeOS · Life System

A mobile life-management app. A pure-frontend web app packaged into an Android app via Capacitor, with a liquid glass visual language.

## Modules
- **Today**: greeting card + lively smart orb + daily progress ring
- **Import**: paste / upload a Markdown note; on-device AI auto-classifies it into plans and tasks
- **Plans**: reading / fitness / diet / custom plans, with task CRUD and reminders
- **Relations**: a zoomable, fullscreen, draggable life map — centered on "life domains", with plans orbiting and auto-connecting
- **Mine**: theme switch, AI engine settings, data backup & export

## Tech stack
- Capacitor + WebView (Android)
- Pure frontend HTML / CSS / JS, localStorage persistence
- On-device heuristic AI engine (switchable to remote in "Mine")

## Run locally
```bash
npm install
npm run copy        # sync index.html -> www/index.html
# open www/index.html in a browser to preview
npm run android     # requires a local Android SDK; builds & opens the native project
```

## Dev logs
See the `journal/` directory for bilingual (Chinese + English) records.

## Author
SWP(SHUAI)
