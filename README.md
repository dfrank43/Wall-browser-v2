# Frameless Browser 1.2.0 — Video Wall

Full source for Intel macOS Electron build. Upload these files at the root of your GitHub repository, retaining `.github/workflows/build-mac.yml`, or keep your existing working workflow.

## Controls
- Command-click: settings for this window
- Command-drag: move window; it stops against other windows and snaps to nearby edges (10 px)
- Command-Option-drag: temporarily allow overlap while dragging
- Command-Shift-S: open settings
- Command-N: new window
- Command-W: close window
- Command-Q: quit and save layout
- Command-V/C/X/A/Z: standard editing in settings

Changing a window's width or aspect ratio tries to relocate it if needed to prevent overlap. If no space fits on a connected display, the change is rejected with an error.

On launch, saved windows that overlap are relocated where possible. When there is insufficient free display area, additional windows cannot open. The app cannot prevent overlap with *other applications*, only its own windows. A Command-Option-drag override may deliberately create overlap; normal dragging then avoids introducing new overlaps but cannot automatically untangle already-overlapping windows.

## Build
Use the included GitHub Actions workflow to create unsigned x64 macOS DMG/ZIP artifacts, or `npm install` followed by `npm run dist` on a Mac.

## Verification
JavaScript syntax and collision logic tested locally. Electron UI and macOS behavior still require testing on a Mac.
