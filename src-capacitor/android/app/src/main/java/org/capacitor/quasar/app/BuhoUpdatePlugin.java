package org.capacitor.quasar.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.InstallSourceInfo;
import android.content.pm.PackageManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.install.InstallStateUpdatedListener;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.InstallStatus;
import com.google.android.play.core.install.model.UpdateAvailability;

/**
 * Minimal bridge around Android's install-source and Google Play update APIs.
 *
 * Play Core is used only when Google Play reports that an update is available
 * for this exact installed package/signature. Every other distribution path
 * stays in JavaScript and opens an allowlisted HTTPS destination.
 */
@CapacitorPlugin(name = "BuhoUpdate", requestCodes = { 48174 })
public class BuhoUpdatePlugin extends Plugin {

    private static final int UPDATE_REQUEST_CODE = 48174;

    private AppUpdateManager appUpdateManager;
    private InstallStateUpdatedListener installListener;
    private PluginCall pendingUpdateCall;

    @Override
    public void load() {
        appUpdateManager = AppUpdateManagerFactory.create(getContext());
        installListener = state -> {
            JSObject event = new JSObject();
            event.put("status", statusName(state.installStatus()));
            event.put("bytesDownloaded", state.bytesDownloaded());
            event.put("totalBytes", state.totalBytesToDownload());
            notifyListeners("playUpdateState", event);
        };
        appUpdateManager.registerListener(installListener);
    }

    @PluginMethod
    public void getInstallSource(PluginCall call) {
        String source = null;
        PackageManager packageManager = getContext().getPackageManager();
        String packageName = getContext().getPackageName();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                InstallSourceInfo info = packageManager.getInstallSourceInfo(packageName);
                source = info.getInstallingPackageName();
            } else {
                // Required for Android 10 and below. The replacement API only
                // exists from API 30 onward.
                //noinspection deprecation
                source = packageManager.getInstallerPackageName(packageName);
            }
        } catch (PackageManager.NameNotFoundException ignored) {
            // A self-query should always exist; null safely maps to APK.
        }

        JSObject result = new JSObject();
        result.put("installSource", source);
        call.resolve(result);
    }

    @PluginMethod
    public void startPlayUpdate(PluginCall call) {
        boolean immediate = Boolean.TRUE.equals(call.getBoolean("immediate"));
        int updateType = immediate ? AppUpdateType.IMMEDIATE : AppUpdateType.FLEXIBLE;

        appUpdateManager.getAppUpdateInfo()
            .addOnSuccessListener(info -> startPlayUpdate(call, info, updateType))
            .addOnFailureListener(error -> call.reject("Google Play update check failed", error));
    }

    @PluginMethod
    public void getPlayUpdateInfo(PluginCall call) {
        appUpdateManager.getAppUpdateInfo()
            .addOnSuccessListener(info -> call.resolve(updateInfoResult(info)))
            .addOnFailureListener(error -> call.reject("Google Play update check failed", error));
    }

    @SuppressWarnings("deprecation")
    private void startPlayUpdate(PluginCall call, AppUpdateInfo info, int updateType) {
        boolean available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
            || info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS;
        if (!available || !info.isUpdateTypeAllowed(updateType)) {
            JSObject result = new JSObject();
            result.put("started", false);
            result.put("reason", "not_available");
            call.resolve(result);
            return;
        }

        try {
            boolean started = appUpdateManager.startUpdateFlowForResult(
                info,
                updateType,
                getActivity(),
                UPDATE_REQUEST_CODE
            );
            if (!started) {
                JSObject result = new JSObject();
                result.put("started", false);
                result.put("reason", "not_started");
                call.resolve(result);
                return;
            }
            pendingUpdateCall = call;
        } catch (Exception error) {
            call.reject("Could not start Google Play update", error);
        }
    }

    @PluginMethod
    public void completePlayUpdate(PluginCall call) {
        appUpdateManager.completeUpdate()
            .addOnSuccessListener(unused -> call.resolve())
            .addOnFailureListener(error -> call.reject("Could not complete Google Play update", error));
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != UPDATE_REQUEST_CODE || pendingUpdateCall == null) return;

        JSObject result = new JSObject();
        result.put("started", true);
        result.put("accepted", resultCode == Activity.RESULT_OK);
        result.put("resultCode", resultCode);
        pendingUpdateCall.resolve(result);
        pendingUpdateCall = null;
    }

    @Override
    protected void handleOnDestroy() {
        if (appUpdateManager != null && installListener != null) {
            appUpdateManager.unregisterListener(installListener);
        }
    }

    private static String statusName(int status) {
        switch (status) {
            case InstallStatus.PENDING: return "pending";
            case InstallStatus.DOWNLOADING: return "downloading";
            case InstallStatus.DOWNLOADED: return "downloaded";
            case InstallStatus.INSTALLING: return "installing";
            case InstallStatus.INSTALLED: return "installed";
            case InstallStatus.FAILED: return "failed";
            case InstallStatus.CANCELED: return "canceled";
            default: return "unknown";
        }
    }

    private static JSObject updateInfoResult(AppUpdateInfo info) {
        JSObject result = new JSObject();
        result.put("status", statusName(info.installStatus()));
        result.put("bytesDownloaded", 0);
        result.put("totalBytes", 0);
        result.put("updateAvailable", info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE);
        result.put(
            "updateInProgress",
            info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
        );
        result.put("immediateAllowed", info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE));
        result.put("flexibleAllowed", info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE));
        result.put("availableVersionCode", info.availableVersionCode());
        return result;
    }
}
