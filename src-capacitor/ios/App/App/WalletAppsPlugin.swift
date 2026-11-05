import Capacitor
import UIKit

/// The wallet apps on this phone that can pay a request, and opening one.
///
/// The system cannot list the apps for a scheme here, so BuhoGO asks about
/// each known wallet's own link (utils/walletAppLinks.js) and lists the ones
/// that open. `canOpenURL` answers yes only for schemes listed in
/// Info.plist's LSApplicationQueriesSchemes; any other scheme reads as not
/// installed. Plain lightning:/bitcoin: are never handed to the system here:
/// with several wallets installed it opens an undefined one, possibly BuhoGO.
///
/// JS contract (the whole plugin, both platforms: services/walletApps.js):
///   - `installed({ urls })` resolves `{ installed: [url] }`, the urls an app
///     on this phone can open
///   - `open({ url, appOnly? })` resolves `{ opened: Bool }`; with `appOnly`
///     a web link opens only the app that claims it, never the browser.
///     A `packageName` is ignored here.
@objc(WalletAppsPlugin)
public class WalletAppsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WalletAppsPlugin"
    public let jsName = "WalletApps"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "installed", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise)
    ]

    @objc func installed(_ call: CAPPluginCall) {
        let urls = call.getArray("urls", String.self) ?? []
        DispatchQueue.main.async {
            let found = urls.filter { string in
                guard let url = URL(string: string) else { return false }
                return UIApplication.shared.canOpenURL(url)
            }
            call.resolve(["installed": found])
        }
    }

    @objc func open(_ call: CAPPluginCall) {
        guard let string = call.getString("url"), let url = URL(string: string) else {
            call.reject("A url is required", "INVALID_ARGUMENT")
            return
        }
        let options: [UIApplication.OpenExternalURLOptionsKey: Any] =
            call.getBool("appOnly", false) ? [.universalLinksOnly: true] : [:]
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: options) { opened in
                call.resolve(["opened": opened])
            }
        }
    }
}
