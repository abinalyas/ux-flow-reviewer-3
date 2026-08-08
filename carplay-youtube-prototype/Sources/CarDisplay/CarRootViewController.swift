import UIKit

/// The full-screen UI rendered on the car display: a browse list on the left, the
/// video surface and transport controls on the right.
///
/// Everything here is hand-rolled UIKit rather than `CPTemplate`, because templates
/// cannot host a video layer. See `CarDisplayPresenter` for why that trade-off makes
/// this a prototype rather than a shippable app.
final class CarRootViewController: UIViewController {

    private let browseList = VideoListViewController()
    private let playerContainer = UIView()
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()
    private let progressBar = UIProgressView(progressViewStyle: .default)
    private let elapsedLabel = UILabel()
    private let remainingLabel = UILabel()
    private let playPauseButton = UIButton(type: .system)
    private let previousButton = UIButton(type: .system)
    private let nextButton = UIButton(type: .system)
    private let placeholderLabel = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        buildLayout()
        wireActions()

        browseList.onSelect = { [weak self] video in
            PlaybackController.shared.play(video, in: VideoCatalog.shared.videos)
            self?.takePlayer()
        }

        NotificationCenter.default.addObserver(
            self, selector: #selector(playbackDidChange),
            name: .playbackDidChange, object: nil
        )

        takePlayer()
        refresh()
    }

    /// Pulls the shared player view into the car window.
    private func takePlayer() {
        PlaybackController.shared.attachPlayer(to: playerContainer)
        placeholderLabel.isHidden = true
    }

    private func buildLayout() {
        addChild(browseList)
        browseList.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(browseList.view)
        browseList.didMove(toParent: self)

        playerContainer.translatesAutoresizingMaskIntoConstraints = false
        playerContainer.backgroundColor = .black
        playerContainer.layer.cornerRadius = 8
        playerContainer.clipsToBounds = true
        view.addSubview(playerContainer)

        placeholderLabel.text = "Select a video"
        placeholderLabel.textColor = .secondaryLabel
        placeholderLabel.font = .preferredFont(forTextStyle: .headline)
        placeholderLabel.textAlignment = .center
        placeholderLabel.translatesAutoresizingMaskIntoConstraints = false
        playerContainer.addSubview(placeholderLabel)

        titleLabel.font = .systemFont(ofSize: 20, weight: .semibold)
        titleLabel.textColor = .white
        titleLabel.numberOfLines = 1

        subtitleLabel.font = .systemFont(ofSize: 15)
        subtitleLabel.textColor = .secondaryLabel
        subtitleLabel.numberOfLines = 1

        progressBar.progressTintColor = .white
        progressBar.trackTintColor = UIColor.white.withAlphaComponent(0.25)

        [elapsedLabel, remainingLabel].forEach {
            $0.font = .monospacedDigitSystemFont(ofSize: 13, weight: .regular)
            $0.textColor = .secondaryLabel
        }
        remainingLabel.textAlignment = .right

        configureTransportButton(previousButton, systemName: "backward.fill")
        configureTransportButton(playPauseButton, systemName: "play.fill", pointSize: 34)
        configureTransportButton(nextButton, systemName: "forward.fill")

        let timeRow = UIStackView(arrangedSubviews: [elapsedLabel, remainingLabel])
        timeRow.axis = .horizontal
        timeRow.distribution = .fillEqually

        let transportRow = UIStackView(arrangedSubviews: [previousButton, playPauseButton, nextButton])
        transportRow.axis = .horizontal
        transportRow.distribution = .fillEqually
        transportRow.spacing = 8

        let infoStack = UIStackView(arrangedSubviews: [
            titleLabel, subtitleLabel, progressBar, timeRow, transportRow
        ])
        infoStack.axis = .vertical
        infoStack.spacing = 8
        infoStack.setCustomSpacing(2, after: titleLabel)
        infoStack.setCustomSpacing(14, after: subtitleLabel)
        infoStack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(infoStack)

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            browseList.view.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            browseList.view.topAnchor.constraint(equalTo: guide.topAnchor),
            browseList.view.bottomAnchor.constraint(equalTo: guide.bottomAnchor),
            browseList.view.widthAnchor.constraint(equalTo: guide.widthAnchor, multiplier: 0.38),

            playerContainer.leadingAnchor.constraint(equalTo: browseList.view.trailingAnchor, constant: 12),
            playerContainer.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -12),
            playerContainer.topAnchor.constraint(equalTo: guide.topAnchor, constant: 12),
            playerContainer.heightAnchor.constraint(equalTo: playerContainer.widthAnchor, multiplier: 9.0 / 16.0),

            placeholderLabel.centerXAnchor.constraint(equalTo: playerContainer.centerXAnchor),
            placeholderLabel.centerYAnchor.constraint(equalTo: playerContainer.centerYAnchor),

            infoStack.leadingAnchor.constraint(equalTo: playerContainer.leadingAnchor),
            infoStack.trailingAnchor.constraint(equalTo: playerContainer.trailingAnchor),
            infoStack.topAnchor.constraint(equalTo: playerContainer.bottomAnchor, constant: 12),
            infoStack.bottomAnchor.constraint(lessThanOrEqualTo: guide.bottomAnchor, constant: -12),

            previousButton.heightAnchor.constraint(equalToConstant: 56)
        ])
    }

    private func configureTransportButton(_ button: UIButton,
                                          systemName: String,
                                          pointSize: CGFloat = 26) {
        let config = UIImage.SymbolConfiguration(pointSize: pointSize, weight: .semibold)
        button.setImage(UIImage(systemName: systemName, withConfiguration: config), for: .normal)
        button.tintColor = .white
    }

    private func wireActions() {
        playPauseButton.addTarget(self, action: #selector(togglePlayPause), for: .touchUpInside)
        previousButton.addTarget(self, action: #selector(goPrevious), for: .touchUpInside)
        nextButton.addTarget(self, action: #selector(goNext), for: .touchUpInside)
    }

    @objc private func togglePlayPause() { PlaybackController.shared.togglePlayPause() }
    @objc private func goPrevious() { PlaybackController.shared.previous() }
    @objc private func goNext() { PlaybackController.shared.next() }

    @objc private func playbackDidChange() { refresh() }

    private func refresh() {
        let controller = PlaybackController.shared
        titleLabel.text = controller.currentVideo?.title ?? "Nothing playing"
        subtitleLabel.text = controller.currentVideo?.channel ?? " "

        let duration = controller.duration
        let elapsed = controller.currentTime
        progressBar.progress = duration > 0 ? Float(elapsed / duration) : 0
        elapsedLabel.text = Self.timestamp(elapsed)
        remainingLabel.text = duration > 0 ? "-" + Self.timestamp(duration - elapsed) : "--:--"

        let symbol = controller.isPlaying ? "pause.fill" : "play.fill"
        configureTransportButton(playPauseButton, systemName: symbol, pointSize: 34)

        placeholderLabel.isHidden = controller.currentVideo != nil
        browseList.highlight(videoID: controller.currentVideo?.id)
    }

    static func timestamp(_ interval: TimeInterval) -> String {
        guard interval.isFinite, interval >= 0 else { return "0:00" }
        let total = Int(interval.rounded())
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}
