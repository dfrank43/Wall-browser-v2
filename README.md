# Frameless Browser v1.3.0

Standalone multi-window Chromium video-wall browser for Intel Mac, Apple Silicon Mac and Windows x64.

## Build with GitHub Actions

Upload all files, including `.github/workflows/build-all.yml`, to the repository root. Remove older workflow files to avoid duplicate builds. In Actions, run **Build Frameless Browser - Mac and Windows**. Three separate downloadable artifacts will be produced if each job succeeds:

- Frameless-Browser-Mac-Intel: DMG + ZIP
- Frameless-Browser-Mac-Apple-Silicon: DMG + ZIP
- Frameless-Browser-Windows-x64: NSIS installer + portable EXE

Builds are unsigned; macOS Gatekeeper and Windows SmartScreen may warn. Review the source and only approve builds you trust.

## Controls

| Action | macOS | Windows |
|---|---|---|
| New window | Cmd+N | Ctrl+N |
| Settings | Cmd+Shift+S or Cmd-click | Ctrl+Shift+S or Ctrl-click |
| Move window | Cmd-drag | Ctrl-drag |
| Debug DevTools | Cmd+Shift+D | Ctrl+Shift+D |
| Mute/unmute | Cmd+Shift+M | Ctrl+Shift+M |
| Window presets | Cmd+Shift+P | Ctrl+Shift+P |

The browser saves layouts and named presets in Electron's per-user application data directory. Window locations and collision handling depend on each OS display configuration. The native mouse modifier and frameless window behavior on Windows still require runtime testing.

## Development

Run `npm install` and `npm start` locally to test. `npm run dist` packages for the current OS with electron-builder defaults. GitHub Actions performs the explicit architecture builds.
