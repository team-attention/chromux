import SwiftUI

struct MainWindowView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        NavigationSplitView {
            ProfileListView(model: model)
                .navigationSplitViewColumnWidth(min: 260, ideal: 300, max: 380)
        } detail: {
            ProfileDetailView(model: model)
        }
        .navigationTitle("chromux")
        .background(DesignTokens.canvas)
        .onAppear { model.markWindowVisible() }
        .onDisappear { model.markWindowHidden() }
    }
}
