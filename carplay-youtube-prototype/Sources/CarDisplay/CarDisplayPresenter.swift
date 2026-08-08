import UIKit

/// Puts the prototype's UI onto the CarPlay Simulator's screen.
///
/// ## Why this is not a real CarPlay app
///
/// A shipping CarPlay app declares a `CPTemplateApplicationSceneSessionRoleApplication`
/// scene and builds its UI from `CPTemplate` subclasses — lists, grids, now-playing.
/// That requires a CarPlay entitlement from Apple, granted only for the published
/// app categories (audio, navigation, communication, EV charging, parking, fueling,
/// food ordering, driving task). None of them permit video, and there is no template
/// that renders an arbitrary view, so a real CarPlay app *cannot* show video.
///
/// This class deliberately sidesteps templates: it treats the car display as a plain
/// external screen and attaches an ordinary `UIWindow` to it, which lets us render a
/// `WKWebView` — and therefore video — on the car surface. The CarPlay Simulator
/// permits this. Real head units do not: without the entitlement iOS never vends the
/// CarPlay screen to the app, so nothing appears. Treat this as a design prototype
/// for capturing video on the car canvas, not a shippable product.
final class CarDisplayPresenter {

    static let shared = CarDisplayPresenter()

    private(set) var window: UIWindow?

    private init() {}

    /// Starts watching for external screens. Call once, from app launch.
    func start() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(screenDidConnect(_:)),
            name: UIScreen.didConnectNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(screenDidDisconnect(_:)),
            name: UIScreen.didDisconnectNotification,
            object: nil
        )

        // A screen may already be attached if the simulator's CarPlay window was
        // opened before the app launched.
        if let screen = UIScreen.screens.first(where: { $0 !== UIScreen.main }) {
            attach(to: screen)
        }
    }

    @objc private func screenDidConnect(_ note: Notification) {
        guard let screen = note.object as? UIScreen else { return }
        attach(to: screen)
    }

    @objc private func screenDidDisconnect(_ note: Notification) {
        guard let screen = note.object as? UIScreen, window?.screen === screen else { return }
        detach()
    }

    // MARK: - Attachment

    /// Scene-based path, used when iOS delivers an external-display scene.
    func attach(to windowScene: UIWindowScene) {
        guard window?.windowScene !== windowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        install(window)
    }

    /// Screen-based path, used when only a bare `UIScreen` shows up.
    func attach(to screen: UIScreen) {
        guard screen !== UIScreen.main, window?.screen !== screen else { return }
        // `UIWindow.screen` is soft-deprecated under scenes but remains the only way
        // to claim a screen that arrived without one.
        let window = UIWindow(frame: screen.bounds)
        window.screen = screen
        install(window)
    }

    private func install(_ window: UIWindow) {
        window.rootViewController = CarRootViewController()
        // The browse list is shared with the phone and uses semantic colours. Car
        // displays are dark surfaces, so pin the trait rather than special-casing
        // every label.
        window.overrideUserInterfaceStyle = .dark
        window.isHidden = false
        self.window = window
        NotificationCenter.default.post(name: .carDisplayDidConnect, object: nil)
    }

    func detach() {
        window?.isHidden = true
        window = nil
        // Hand the player back to the phone before the car window goes away, so the
        // web view is never left orphaned mid-playback.
        NotificationCenter.default.post(name: .carDisplayDidDisconnect, object: nil)
    }

    var isConnected: Bool { window != nil }
}

extension Notification.Name {
    static let carDisplayDidConnect = Notification.Name("CarDisplayDidConnect")
    static let carDisplayDidDisconnect = Notification.Name("CarDisplayDidDisconnect")
}
