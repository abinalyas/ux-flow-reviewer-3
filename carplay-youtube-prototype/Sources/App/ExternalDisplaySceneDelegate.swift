import UIKit

/// Receives the car display when iOS vends it as a scene rather than a bare
/// `UIScreen`. Delegates to `CarDisplayPresenter` so both delivery paths build the
/// same window exactly once.
final class ExternalDisplaySceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene,
               willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        CarDisplayPresenter.shared.attach(to: windowScene)
        window = CarDisplayPresenter.shared.window
    }

    func sceneDidDisconnect(_ scene: UIScene) {
        CarDisplayPresenter.shared.detach()
        window = nil
    }
}
