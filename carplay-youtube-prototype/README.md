# CarPlay YouTube Prototype

A development-only iOS prototype that renders the official YouTube IFrame player on
a car-style display, with a browse list and transport controls, so you can evaluate
what a video experience on the car canvas would feel like.

> **This cannot ship.** It is a design prototype, not a product. Read
> [Why this cannot ship](#why-this-cannot-ship) before building anything on top of it.

---

## Why this cannot ship

A real CarPlay app declares a `CPTemplateApplicationSceneSessionRoleApplication`
scene and builds its entire UI out of `CPTemplate` subclasses — `CPListTemplate`,
`CPGridTemplate`, `CPNowPlayingTemplate`, and so on. The app never draws pixels on
the car screen; it describes content and iOS renders it. Two consequences follow:

1. **There is no video template.** No `CPTemplate` hosts an arbitrary view, layer, or
   web view, so a template-based CarPlay app has no mechanism to display video at all.
2. **Templates require an entitlement.** Apple grants CarPlay entitlements only for
   published app categories — audio, navigation, communication, EV charging, parking,
   fueling, quick food ordering, and driving task. None of them permit video. This is
   a driver-distraction rule, which is also why YouTube's own iOS app has no CarPlay
   video mode.

This prototype sidesteps templates entirely. Instead of asking for a CarPlay scene,
it treats the car display as an ordinary **external screen** and attaches a plain
`UIWindow` to it (`Sources/CarDisplay/CarDisplayPresenter.swift`). A normal `UIWindow`
can host a `WKWebView`, and a `WKWebView` can play video — which is the whole trick.

The trick only works in the simulator. On real hardware, without a CarPlay
entitlement iOS never vends the car display to your app, so nothing appears; and with
one, you are back to templates and still cannot draw video. Treat the output of this
repo as a prototype video you can put in front of stakeholders, not as a path to the
App Store.

---

## What is in here

| Path | Purpose |
| --- | --- |
| `Sources/Player/YouTubePlayerView.swift` | `WKWebView` hosting YouTube's IFrame player, with a JS ↔ Swift bridge |
| `Sources/Player/PlaybackController.swift` | Single shared player, queue, and transport state |
| `Sources/Player/NowPlayingController.swift` | `MPNowPlayingInfoCenter` + remote commands |
| `Sources/CarDisplay/CarDisplayPresenter.swift` | Detects the external screen, builds the car window |
| `Sources/CarDisplay/CarRootViewController.swift` | Car UI: browse list, video surface, transport controls |
| `Sources/Shared/VideoListViewController.swift` | Browse list, shared by phone and car |
| `Sources/Phone/PhoneViewController.swift` | Phone UI and hand-off banner |
| `Resources/player.html` | The IFrame player document |
| `Resources/catalog.json` | Bundled sample videos, so the app runs with zero setup |

### Playback uses the official embedded player

Playback goes through YouTube's IFrame Player API rather than extracting a stream
URL. That is the only approach consistent with YouTube's Terms of Service — ads,
analytics, and per-video embedding restrictions are all enforced by the embedded
player itself. Videos whose owners disabled embedding will fail with error 101/150,
and the app surfaces that rather than working around it.

### One player, moved between screens

A `UIView` lives in one view hierarchy at a time. When the car display connects, the
single `YouTubePlayerView` is re-parented into the car window and the phone shows a
"Playing on the car display" banner. Two player instances would mean two audio
streams and two sets of ad impressions, so the prototype deliberately avoids that.

---

## Running it

Requires Xcode 15 or newer (deployment target iOS 16).

```bash
git clone <this repo>
cd carplay-youtube-prototype
make open          # or: open CarPlayYouTube.xcodeproj
```

Build and run on any iPhone simulator. The phone UI works immediately: pick a video
from the bundled catalog and it plays inline.

### Getting the car display up

With the simulator focused, open **I/O → External Displays** and pick a display:

- **CarPlay** gives you the car-shaped canvas. Whether the simulator hands that screen
  to a third-party app as a plain `UIScreen` depends on your Xcode and iOS version —
  Apple has tightened this over time, and it is exactly the behaviour the entitlement
  is meant to gate. If the CarPlay window shows only the system home screen and your
  UI never appears, that check is active on your setup.
- **Any non-CarPlay resolution** (for example 1920×1080) is always vended to apps.
  This is the reliable way to exercise the full car UI — the same
  `CarRootViewController` renders on it, at a car-like aspect ratio, and every
  interaction works. Use this if the CarPlay option does not attach.

Both delivery paths are handled: `ExternalDisplaySceneDelegate` picks up scene-based
delivery, and `CarDisplayPresenter` observes `UIScreen.didConnectNotification` for the
bare-screen case. They funnel into the same window and ignore duplicate attachment.

### Optional: YouTube search

Without a key the app browses `Resources/catalog.json` and the search bar is hidden.
To enable search against the YouTube Data API v3:

```bash
make secrets                       # creates Config/Secrets.xcconfig (git-ignored)
# add YOUTUBE_API_KEY = <your key>
make project                       # picks the xcconfig up as the base configuration
```

`Config/Secrets.xcconfig` is git-ignored so the key never lands in a commit.

---

## Project generation

`CarPlayYouTube.xcodeproj` is generated by `Tools/generate_project.rb` and committed
so the repo opens in Xcode directly. After adding, moving, or deleting a source file:

```bash
gem install xcodeproj   # once
make project
```

Regenerating rather than hand-editing keeps the `pbxproj` free of the merge conflicts
that file is notorious for.

---

## If you want something shippable instead

The nearest thing that can actually reach the App Store is a **CarPlay audio app**:

- `com.apple.developer.carplay-audio` entitlement, requested from Apple.
- A `CPTemplateApplicationScene` with `CPListTemplate` for browsing and
  `CPNowPlayingTemplate` for transport.
- Audio-only playback routed to the car; any video surface stays on the phone and is
  hidden while driving.

`NowPlayingController` and `PlaybackController` in this repo carry over to that design
almost unchanged — `MPNowPlayingInfoCenter` and `MPRemoteCommandCenter` need no
entitlement and behave identically on real hardware. The parts that would be replaced
are `CarDisplayPresenter` and `CarRootViewController`.

Note that an audio-only YouTube experience raises its own Terms of Service question:
YouTube's terms require the video component to remain visible in the embedded player,
so a production audio app would need content licensed for audio-only playback, not
YouTube.
