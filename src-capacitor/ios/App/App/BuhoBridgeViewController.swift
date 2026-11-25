import Capacitor
import UIKit

/// The app's web view host. Exists to register the plugins that live in this
/// Xcode project rather than in an npm package; Capacitor only discovers the
/// packaged ones on its own. Main.storyboard points at this class.
class BuhoBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(FileExportPlugin())
        bridge?.registerPluginInstance(WalletAppsPlugin())

        // Until the page draws its first frame, the web view shows its own
        // background (Capacitor's default is systemBackground: white, or
        // black in dark). Use the launch screen's colour instead, so the
        // launch screen, the empty web view and LaunchMark.vue's first frame
        // are one picture.
        if let launchBackground = UIColor(named: "LaunchBackground") {
            webView?.backgroundColor = launchBackground
            webView?.scrollView.backgroundColor = launchBackground
        }
    }
}
