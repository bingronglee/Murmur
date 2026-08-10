import Combine
import Foundation
import Network
import WatchConnectivity

final class PhoneTransferManager: NSObject, ObservableObject {
    static let shared = PhoneTransferManager()
    static let defaultUploadEndpoint = "http://localhost:3000/api/upload"

    @Published private(set) var statusMessage = "等待 Apple Watch 錄音"
    @Published private(set) var pendingCount = 0
    @Published private(set) var watchState = "尚未連線"

    private let fileManager = FileManager.default
    private let networkMonitor = NWPathMonitor()
    private let workerQueue = DispatchQueue(label: "VoiceNotesPhone.Transfer")
    private let incomingDirectory: URL
    private var watchSession: WCSession?

    private lazy var backgroundSession: URLSession = {
        let configuration = URLSessionConfiguration.background(
            withIdentifier: "com.cool.voicenotes.phone.upload"
        )
        configuration.sessionSendsLaunchEvents = true
        configuration.isDiscretionary = false
        configuration.waitsForConnectivity = true
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    private override init() {
        let applicationSupport = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!
        incomingDirectory = applicationSupport.appendingPathComponent("PendingVoiceNotes", isDirectory: true)
        super.init()

        try? fileManager.createDirectory(
            at: incomingDirectory,
            withIntermediateDirectories: true
        )
        UserDefaults.standard.register(defaults: [
            "uploadEndpoint": Self.defaultUploadEndpoint,
            "uploadToken": "",
        ])

        configureWatchConnectivity()
        configureNetworkMonitor()
        refreshPendingCount()
        _ = backgroundSession
    }

    private func configureWatchConnectivity() {
        guard WCSession.isSupported() else {
            watchState = "此裝置不支援"
            return
        }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        watchSession = session
    }

    private func configureNetworkMonitor() {
        networkMonitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            self?.retryPendingUploads()
        }
        networkMonitor.start(queue: workerQueue)
    }

    func retryPendingUploads() {
        workerQueue.async { [weak self] in
            guard let self else { return }
            let files = (try? self.fileManager.contentsOfDirectory(
                at: self.incomingDirectory,
                includingPropertiesForKeys: nil
            )) ?? []

            self.backgroundSession.getAllTasks { tasks in
                let activeNames = Set(tasks.compactMap(\.taskDescription))
                files
                    .filter { $0.pathExtension.lowercased() == "m4a" }
                    .filter { !activeNames.contains($0.lastPathComponent) }
                    .forEach { self.startUpload(for: $0) }
                self.refreshPendingCount()
            }
        }
    }

    private func startUpload(for fileURL: URL) {
        guard
            let endpointValue = UserDefaults.standard.string(forKey: "uploadEndpoint"),
            let endpoint = URL(string: endpointValue),
            !endpointValue.isEmpty
        else {
            updateStatus("請先在 iPhone App 設定上傳服務網址")
            return
        }

        let token = UserDefaults.standard.string(forKey: "uploadToken") ?? ""
        guard !token.isEmpty else {
            updateStatus("請先在 iPhone App 設定上傳金鑰")
            return
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("audio/mp4", forHTTPHeaderField: "Content-Type")
        request.setValue(fileURL.lastPathComponent, forHTTPHeaderField: "X-Voice-Note-Filename")
        request.setValue(token, forHTTPHeaderField: "X-Auth-Token")

        let task = backgroundSession.uploadTask(with: request, fromFile: fileURL)
        task.taskDescription = fileURL.lastPathComponent
        task.resume()
        updateStatus("正在上傳 \(fileURL.lastPathComponent)")
    }

    private func storeReceivedFile(_ file: WCSessionFile) throws -> URL {
        let suggestedName = (file.metadata?["filename"] as? String)
            ?? "watch-voice-\(UUID().uuidString).m4a"
        let safeName = URL(fileURLWithPath: suggestedName).lastPathComponent
        let destination = uniqueDestination(for: safeName)
        try fileManager.moveItem(at: file.fileURL, to: destination)
        return destination
    }

    private func uniqueDestination(for filename: String) -> URL {
        let proposed = incomingDirectory.appendingPathComponent(filename)
        guard fileManager.fileExists(atPath: proposed.path) else { return proposed }
        let stem = proposed.deletingPathExtension().lastPathComponent
        return incomingDirectory.appendingPathComponent("\(stem)-\(UUID().uuidString.prefix(8)).m4a")
    }

    private func refreshPendingCount() {
        let count = ((try? fileManager.contentsOfDirectory(
            at: incomingDirectory,
            includingPropertiesForKeys: nil
        )) ?? []).filter { $0.pathExtension.lowercased() == "m4a" }.count
        DispatchQueue.main.async { self.pendingCount = count }
    }

    private func updateStatus(_ message: String) {
        DispatchQueue.main.async { self.statusMessage = message }
    }
}

extension PhoneTransferManager: WCSessionDelegate {
    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        DispatchQueue.main.async {
            self.watchState = error == nil && activationState == .activated ? "已啟用" : "連線失敗"
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    func session(_ session: WCSession, didReceive file: WCSessionFile) {
        do {
            let storedFile = try storeReceivedFile(file)
            let watchFilename = (file.metadata?["filename"] as? String)
                .map { URL(fileURLWithPath: $0).lastPathComponent }
                ?? storedFile.lastPathComponent
            updateStatus("已收到 \(storedFile.lastPathComponent)")
            session.transferUserInfo([
                "receivedFilename": watchFilename,
                "receivedAt": Date().timeIntervalSince1970,
            ])
            refreshPendingCount()
            retryPendingUploads()
        } catch {
            updateStatus("保存 Watch 錄音失敗：\(error.localizedDescription)")
        }
    }
}

extension PhoneTransferManager: URLSessionTaskDelegate, URLSessionDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        guard let filename = task.taskDescription else { return }
        let fileURL = incomingDirectory.appendingPathComponent(filename)
        let statusCode = (task.response as? HTTPURLResponse)?.statusCode
        let succeeded = error == nil && statusCode.map { 200..<300 ~= $0 } == true

        if succeeded {
            do {
                try fileManager.removeItem(at: fileURL)
                watchSession?.transferUserInfo([
                    "uploadedFilename": filename,
                    "uploadedAt": Date().timeIntervalSince1970,
                ])
                updateStatus("已完成上傳：\(filename)")
            } catch {
                updateStatus("上傳完成，但清理暫存失敗")
            }
        } else {
            updateStatus("上傳失敗，已保留並等待自動重試")
        }
        refreshPendingCount()
    }
}
