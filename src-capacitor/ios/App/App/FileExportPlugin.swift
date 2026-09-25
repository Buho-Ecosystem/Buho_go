import Capacitor
import UIKit

/// "Save" for files the app produces (transaction reports).
///
/// Presents the system export dialog, `UIDocumentPickerViewController` in
/// exporting mode, so the user picks where the file goes: On My iPhone,
/// iCloud Drive or any installed file provider. The dialog copies the file, so
/// the staged original is removed as soon as it closes.
///
/// The share sheet stays a separate action in JS. Its "Save to Files" works,
/// but it sits among every other share target; a dedicated Save is the direct
/// route.
///
/// JS contract: `save({ filename, mimeType, data })` with `data` in base64,
/// resolving `{ saved: true }` once the file is in place, or
/// `{ saved: false }` when the user cancels.
@objc(FileExportPlugin)
public class FileExportPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "FileExportPlugin"
    public let jsName = "FileExport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise)
    ]

    /// The save in progress. Only one dialog can be on screen at a time.
    private var pending: (call: CAPPluginCall, stagingDirectory: URL)?

    @objc func save(_ call: CAPPluginCall) {
        guard let filename = call.getString("filename"), !filename.isEmpty,
              let encoded = call.getString("data"),
              let data = Data(base64Encoded: encoded) else {
            call.reject("filename and base64 data are required", "INVALID_ARGUMENT")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard self.pending == nil else {
                call.reject("A save is already in progress", "BUSY")
                return
            }
            guard let presenter = self.topViewController() else {
                call.reject("Nothing to present the save dialog from", "UNAVAILABLE")
                return
            }

            let stagingDirectory: URL
            let file: URL
            do {
                (stagingDirectory, file) = try Self.stage(data, named: filename)
            } catch {
                call.reject("The file couldn't be prepared", "WRITE_FAILED", error)
                return
            }

            let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
            picker.delegate = self
            self.pending = (call, stagingDirectory)
            presenter.present(picker, animated: true)
        }
    }

    // MARK: - UIDocumentPickerDelegate

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finish(saved: true)
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finish(saved: false)
    }

    // MARK: - Private

    private func finish(saved: Bool) {
        guard let (call, stagingDirectory) = pending else { return }
        pending = nil
        try? FileManager.default.removeItem(at: stagingDirectory)
        call.resolve(["saved": saved])
    }

    /// The dialog must be presented by whatever is on top, or UIKit refuses.
    private func topViewController() -> UIViewController? {
        var top = bridge?.viewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }

    /// Writes the bytes under their final name in a directory of their own,
    /// so the name the dialog proposes is exactly the one the user was shown,
    /// and two saves of the same name never collide.
    private static func stage(_ data: Data, named filename: String) throws -> (directory: URL, file: URL) {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("FileExport", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent((filename as NSString).lastPathComponent)
        try data.write(to: file, options: .atomic)
        return (directory, file)
    }
}
