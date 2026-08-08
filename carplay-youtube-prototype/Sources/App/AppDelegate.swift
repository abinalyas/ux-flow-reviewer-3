import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Watch for the CarPlay Simulator's screen. Scene-based delivery is handled
        // separately by `ExternalDisplaySceneDelegate`; both funnel into the same
        // presenter, which ignores duplicate attachments.
        CarDisplayPresenter.shared.start()
        return true
    }

    func application(_ application: UIApplication,
                     configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        if session.role == .windowExternalDisplayNonInteractive {
            return UISceneConfiguration(name: "ExternalDisplay", sessionRole: session.role)
        }
        return UISceneConfiguration(name: "Phone", sessionRole: session.role)
    }
}
