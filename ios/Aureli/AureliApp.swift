import SwiftUI

@main
struct AureliApp: App {
    @State private var store = WorkspaceStore()
    var body: some Scene {
        WindowGroup {
            RootView().environment(store).tint(.accentColor)
        }
    }
}
