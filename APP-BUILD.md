# The Kolours — Native App (Capacitor)

The iOS and Android apps wrap the existing web app (`index.html`) using
[Capacitor](https://capacitorjs.com). The web UI is bundled into the app, while
paintings, orders, auth, and payments still talk to Firebase / Stripe / Cloudinary
at runtime — so day-to-day content stays live without rebuilding the app.

- **App ID (permanent):** `com.thekolours.app`
- **App name:** The Kolours
- **Web bundle:** `www/` (generated from `index.html` + `images/`)

## One-time prerequisites (on your Mac)
- **Xcode** (App Store) + an **Apple Developer account** ($99/yr) for iOS.
- **Android Studio** + **JDK 17** for Android, and a **Google Play** account ($25 once).
- Node is already used here. (Capacitor 8 uses Swift Package Manager, so **no CocoaPods needed**.)

## Everyday workflow
After editing `index.html` (the single source of truth for both web and app):

```bash
npm run sync          # rebuilds www/ and copies it into ios/ + android/
npm run open:ios      # opens Xcode      (or: npx cap open ios)
npm run open:android  # opens Android Studio (or: npx cap open android)
```

## Build & submit — iOS
1. `npm run sync && npm run open:ios`
2. In Xcode: select the **App** target → **Signing & Capabilities** → choose your Team
   (Xcode auto-creates the provisioning profile for `com.thekolours.app`).
3. Pick a device/simulator and **Run** to test.
4. To ship: **Product → Archive** → **Distribute App → App Store Connect** → upload.
5. In [App Store Connect](https://appstoreconnect.apple.com): create the app
   (bundle ID `com.thekolours.app`), add screenshots/description, attach the build, submit for review.

## Build & submit — Android
1. `npm run sync && npm run open:android`
2. In Android Studio let Gradle sync, then **Run** on an emulator/device to test.
3. To ship: **Build → Generate Signed Bundle / APK → Android App Bundle (.aab)**.
   Create/keep an **upload keystore** (back it up — losing it blocks future updates).
4. In [Play Console](https://play.google.com/console): create the app, upload the
   `.aab`, fill the store listing, and roll out.

## Icons & splash
Source images live in `assets/` (`icon.png` 1024², `splash.png` 2732²) and were
generated into both platforms with `npm run icons`. To rebrand, replace those two
files and re-run `npm run icons`. (Current icon is the logo on the `#f5f5f0` brand
background — swap in a dedicated square mark for a stronger icon.)

## ⚠️ Required for in-app checkout to work
The Stripe checkout Cloud Function only accepts requests from allow-listed origins.
The app's webview origins (`capacitor://localhost`, `https://localhost`) were added
to `functions/index.js` — **deploy once** so in-app "Proceed to Checkout" works:

```bash
firebase deploy --only functions --project the-kolours
```

## Known follow-ups (not blockers)
- **Stripe redirect:** checkout does `window.location.href = <stripe url>`, which
  navigates the webview to Stripe and then back to `thekolours.com` (the live site)
  inside the app. Cleaner UX: open Stripe via `@capacitor/browser` and return through
  an app deep link. Fine for a first submission; worth polishing.
- **Offline:** the app shell is bundled, but fonts/icons/Firebase load from CDNs, so
  an offline launch shows an unstyled/empty state. Bundling those would make it fully offline.
- **Apple review:** because this reuses the website, lead the review notes with the
  native value (installable, push-ready, offline shell) to avoid guideline 4.2 friction.
