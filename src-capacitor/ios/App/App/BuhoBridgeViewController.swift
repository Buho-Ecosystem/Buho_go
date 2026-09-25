import Capacitor
import UIKit

/// The app's web view host. Exists to register the plugins that live in this
/// Xcode project rather than in an npm package; Capacitor only discovers the
/// packaged ones on its own. Main.storyboard points at this class.
class BuhoBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(FileExportPlugin())
    }
}
