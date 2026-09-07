import SwiftUI
import UIKit

final class PhoneAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        PhoneTransferManager.shared.handleEvents(
            forBackgroundURLSession: identifier,
            completionHandler: completionHandler
        )
    }
}

@main
struct VoiceNotesPhoneApp: App {
    @UIApplicationDelegateAdaptor(PhoneAppDelegate.self) private var appDelegate
    @StateObject private var transferManager = PhoneTransferManager.shared

    var body: some Scene {
        WindowGroup {
            PhoneContentView()
                .environmentObject(transferManager)
        }
    }
}
