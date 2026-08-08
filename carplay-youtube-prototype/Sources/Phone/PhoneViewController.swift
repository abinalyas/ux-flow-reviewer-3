import UIKit

/// Phone-side UI. Holds the player when no car display is attached, and shows a
/// hand-off banner while the car display owns it.
final class PhoneViewController: UIViewController {

    private let playerContainer = UIView()
    private let handoffLabel = UILabel()
    private let browseList = VideoListViewController()
    private let searchController = UISearchController(searchResultsController: nil)

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "CarPlay YouTube Prototype"
        view.backgroundColor = .systemBackground
        navigationController?.navigationBar.prefersLargeTitles = false

        buildLayout()
        configureSearch()

        browseList.onSelect = { [weak self] video in
            PlaybackController.shared.play(video, in: VideoCatalog.shared.videos)
            self?.updateHosting()
        }

        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(updateHosting),
                           name: .carDisplayDidConnect, object: nil)
        center.addObserver(self, selector: #selector(updateHosting),
                           name: .carDisplayDidDisconnect, object: nil)
        center.addObserver(self, selector: #selector(updateHosting),
                           name: .playerHostDidChange, object: nil)
        center.addObserver(self, selector: #selector(playbackDidFail(_:)),
                           name: .playbackDidFail, object: nil)

        updateHosting()
    }

    private func buildLayout() {
        playerContainer.translatesAutoresizingMaskIntoConstraints = false
        playerContainer.backgroundColor = .black
        view.addSubview(playerContainer)

        handoffLabel.translatesAutoresizingMaskIntoConstraints = false
        handoffLabel.text = "Playing on the car display"
        handoffLabel.textColor = .white
        handoffLabel.textAlignment = .center
        handoffLabel.font = .preferredFont(forTextStyle: .headline)
        handoffLabel.numberOfLines = 0
        handoffLabel.isHidden = true
        playerContainer.addSubview(handoffLabel)

        addChild(browseList)
        browseList.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(browseList.view)
        browseList.didMove(toParent: self)

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            playerContainer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            playerContainer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            playerContainer.topAnchor.constraint(equalTo: guide.topAnchor),
            playerContainer.heightAnchor.constraint(equalTo: view.widthAnchor, multiplier: 9.0 / 16.0),

            handoffLabel.leadingAnchor.constraint(equalTo: playerContainer.leadingAnchor, constant: 16),
            handoffLabel.trailingAnchor.constraint(equalTo: playerContainer.trailingAnchor, constant: -16),
            handoffLabel.centerYAnchor.constraint(equalTo: playerContainer.centerYAnchor),

            browseList.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            browseList.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            browseList.view.topAnchor.constraint(equalTo: playerContainer.bottomAnchor),
            browseList.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    private func configureSearch() {
        guard VideoCatalog.shared.isSearchAvailable else { return }
        searchController.searchBar.placeholder = "Search YouTube"
        searchController.searchBar.delegate = self
        searchController.obscuresBackgroundDuringPresentation = false
        navigationItem.searchController = searchController
        navigationItem.hidesSearchBarWhenScrolling = false
    }

    /// Reclaims the player when no car display is attached; yields it when one is.
    @objc private func updateHosting() {
        if CarDisplayPresenter.shared.isConnected {
            handoffLabel.isHidden = false
        } else {
            handoffLabel.isHidden = true
            PlaybackController.shared.attachPlayer(to: playerContainer)
        }
    }

    @objc private func playbackDidFail(_ note: Notification) {
        let code = note.userInfo?["code"] as? Int ?? -1
        // 101/150 both mean the uploader disabled embedding, which is the common
        // real-world failure for an IFrame-based player.
        let message = (code == 101 || code == 150)
            ? "The owner of this video does not allow it to be played in embedded players."
            : "This video could not be played (error \(code))."
        let alert = UIAlertController(title: "Playback failed", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}

extension PhoneViewController: UISearchBarDelegate {

    func searchBarSearchButtonClicked(_ searchBar: UISearchBar) {
        guard let query = searchBar.text, !query.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        searchBar.resignFirstResponder()
        VideoCatalog.shared.search(query) { [weak self] result in
            if case .failure(let error) = result {
                let alert = UIAlertController(title: "Search failed",
                                              message: error.localizedDescription,
                                              preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "OK", style: .default))
                self?.present(alert, animated: true)
            }
        }
    }

    func searchBarCancelButtonClicked(_ searchBar: UISearchBar) {
        VideoCatalog.shared.resetToBundled()
    }
}
