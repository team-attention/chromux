import SwiftUI
import AppKit

struct MainWindowView: View {
    @ObservedObject var model: AppModel
    let onWindowResolved: (NSWindow) -> Void

    var body: some View {
        NavigationSplitView {
            ProfileListView(model: model)
                .navigationSplitViewColumnWidth(min: 260, ideal: 300, max: 380)
        } detail: {
            ProfileDetailView(model: model)
        }
        .navigationTitle("chromux")
        .background(DesignTokens.canvas)
        .background(WindowAccessor(onResolve: onWindowResolved))
    }
}
