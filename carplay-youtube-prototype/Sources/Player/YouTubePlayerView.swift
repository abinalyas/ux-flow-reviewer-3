import UIKit
import WebKit

/// Playback states mirrored from the YouTube IFrame API's `YT.PlayerState`.
enum YouTubePlayerState: Int {
    case unstarted = -1
    case ended = 0
    case playing = 1
    case paused = 2
    case buffering = 3
    case cued = 5
}

protocol YouTubePlayerViewDelegate: AnyObject {
    func playerViewDidBecomeReady(_ view: YouTubePlayerView)
    func playerView(_ view: YouTubePlayerView, didChangeState state: YouTubePlayerState)
    func playerView(_ view: YouTubePlayerView, didUpdateTime time: TimeInterval, duration: TimeInterval)
    func playerView(_ view: YouTubePlayerView, didFailWithCode code: Int)
}

/// Hosts the official YouTube IFrame player inside a `WKWebView`.
///
/// Using the IFrame player (rather than extracting a stream URL) is the only way to
/// play YouTube content within YouTube's terms of service: ads, analytics, and
/// playback restrictions are all honoured by the embedded player itself.
final class YouTubePlayerView: UIView {

    weak var delegate: YouTubePlayerViewDelegate?

    private(set) var isReady = false
    private(set) var currentVideoID: String?

    private let messageHandlerName = "player"
    private var webView: WKWebView!

    override init(frame: CGRect) {
        super.init(frame: frame)
        setUpWebView()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setUpWebView()
    }

    deinit {
        webView?.configuration.userContentController
            .removeScriptMessageHandler(forName: messageHandlerName)
    }

    private func setUpWebView() {
        backgroundColor = .black

        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        // A non-persistent store keeps the prototype from writing YouTube cookies to disk.
        configuration.websiteDataStore = .nonPersistent()

        // `WKScriptMessageHandler` retains its handler, so route through a weak proxy
        // to avoid a retain cycle back into this view.
        let proxy = ScriptMessageProxy()
        proxy.target = self
        configuration.userContentController.add(proxy, name: messageHandlerName)

        webView = WKWebView(frame: bounds, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        addSubview(webView)

        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: trailingAnchor),
            webView.topAnchor.constraint(equalTo: topAnchor),
            webView.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])

        loadPlayerDocument()
    }

    private func loadPlayerDocument() {
        guard let url = Bundle.main.url(forResource: "player", withExtension: "html"),
              let html = try? String(contentsOf: url, encoding: .utf8) else {
            assertionFailure("player.html missing from bundle")
            return
        }
        // The IFrame API refuses to initialise from an `about:blank` origin, so the
        // document is loaded with a youtube.com base URL.
        webView.loadHTMLString(html, baseURL: URL(string: "https://www.youtube.com"))
    }

    // MARK: - Commands

    func load(videoID: String) {
        currentVideoID = videoID
        evaluate("loadVideo('\(videoID.jsEscaped)')")
    }

    func play() {
        evaluate("playVideo()")
    }

    func pause() {
        evaluate("pauseVideo()")
    }

    func seek(to seconds: TimeInterval) {
        evaluate("seekTo(\(max(0, seconds)))")
    }

    func setVolume(_ volume: Int) {
        evaluate("setVolume(\(min(100, max(0, volume))))")
    }

    private func evaluate(_ javaScript: String) {
        webView.evaluateJavaScript(javaScript) { _, error in
            if let error {
                NSLog("[YouTubePlayerView] JS error for `\(javaScript)`: \(error)")
            }
        }
    }

    // MARK: - Bridge

    fileprivate func handle(message body: [String: Any]) {
        guard let event = body["event"] as? String else { return }
        switch event {
        case "ready":
            isReady = true
            delegate?.playerViewDidBecomeReady(self)
        case "state":
            let raw = body["state"] as? Int ?? -1
            delegate?.playerView(self, didChangeState: YouTubePlayerState(rawValue: raw) ?? .unstarted)
        case "time":
            let time = body["time"] as? Double ?? 0
            let duration = body["duration"] as? Double ?? 0
            delegate?.playerView(self, didUpdateTime: time, duration: duration)
        case "error":
            delegate?.playerView(self, didFailWithCode: body["code"] as? Int ?? -1)
        default:
            break
        }
    }
}

/// Breaks the `WKUserContentController` -> handler -> view retain cycle.
private final class ScriptMessageProxy: NSObject, WKScriptMessageHandler {
    weak var target: YouTubePlayerView?

    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        target?.handle(message: body)
    }
}

private extension String {
    /// Minimal escaping for interpolation into a single-quoted JS string literal.
    var jsEscaped: String {
        replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
    }
}
