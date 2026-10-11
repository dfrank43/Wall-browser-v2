# Frameless Browser — Intel Mac standalone build

Designed for the Intel-based 2019 16-inch MacBook Pro. Frameless Chromium windows, no tabs. Command-click a page to edit its URL, aspect ratio, and width. Command-N opens a new window; Command-comma opens settings. Window configurations persist between launches.

## Build without installing developer tools on your Mac
1. Create a GitHub repository and upload **the contents** of this folder, including the hidden `.github/workflows/build-mac.yml` file. You can upload the ZIP contents using GitHub's **Add file → Upload files** interface; ensure the workflow path is preserved.
2. Open the repository's **Actions** tab and choose **Build Intel Mac App** → **Run workflow**.
3. When the build completes, open the run, download the **Frameless-Browser-Intel-Mac** artifact, unzip it, and open the `.dmg` to drag the app to Applications (or extract the `.app` from the distribution ZIP).
4. The app is unsigned/not notarized. macOS may block the first launch; in System Settings → Privacy & Security choose **Open Anyway** for this app if you trust your own build.

## Local build (optional)
Install Node.js 22+, then run `npm install` and `npm run dist`. Intel `.dmg` and `.zip` outputs appear in `dist/`.

## Notes
The built `.app` is standalone: no Node.js, Electron, or Chrome installation is needed to run it. Electron bundles a Chromium version, which may lag Chrome stable. This is a prototype and not a security-hardened browser for untrusted sites. Some DRM video services and Chrome extensions may not work. Command-click interception may not work on every site or embedded frame. No standard title bar means window movement is limited.
