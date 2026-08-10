import SwiftUI

@main
struct VoiceNotesPhoneApp: App {
    @StateObject private var transferManager = PhoneTransferManager.shared

    var body: some Scene {
        WindowGroup {
            PhoneContentView()
                .environmentObject(transferManager)
        }
    }
}
