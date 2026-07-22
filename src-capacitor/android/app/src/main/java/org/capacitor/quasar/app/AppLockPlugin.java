package org.capacitor.quasar.app;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.pm.PackageManager;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.Executor;

/**
 * AppLockPlugin — device authentication for the app lock and sensitive
 * reveals (recovery phrase, Nostr key).
 *
 * Exists because the third-party biometric plugin's Android prompt only
 * accepts class-3 (strong) biometrics and always attaches a negative
 * button, which the platform forbids to combine with device-credential
 * fallback. The result: devices with only a PIN/pattern/password, and
 * devices whose biometrics are class-2 (weak), could never complete a
 * verification even though the availability probe reported them capable.
 *
 * This plugin drives androidx BiometricPrompt directly with
 * BIOMETRIC_WEAK | DEVICE_CREDENTIAL, which yields the intended
 * preference order natively: the system sheet shows the strongest
 * enrolled biometric first (face or fingerprint) and offers the device
 * PIN, pattern, or password as the built-in fallback. On devices with no
 * biometrics at all, the lockscreen credential is prompted directly.
 *
 * No CryptoObject is attached: this is an access gate in front of the
 * UI, not a key-release mechanism. Wallet material stays protected by
 * its own encryption layer.
 */
@CapacitorPlugin(name = "AppLock")
public class AppLockPlugin extends Plugin {

    /**
     * Availability probe.
     *
     * biometryType mirrors the values the JS layer already understands:
     * 'fingerprint' | 'face' | 'iris' | 'multiple' | 'device-pin' | 'none'.
     * DEVICE_CREDENTIAL is deliberately not queried through
     * BiometricManager.canAuthenticate — that combination is unreliable
     * below API 30 — KeyguardManager.isDeviceSecure() is the stable signal.
     */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        boolean biometricEnrolled = biometricEnrolled();
        boolean deviceSecure = deviceIsSecure();

        JSObject ret = new JSObject();
        ret.put("available", biometricEnrolled || deviceSecure);
        ret.put("deviceIsSecure", deviceSecure);
        ret.put("biometryType", resolveBiometryType(biometricEnrolled, deviceSecure));
        call.resolve(ret);
    }

    @PluginMethod
    public void verify(PluginCall call) {
        boolean biometricEnrolled = biometricEnrolled();
        boolean deviceSecure = deviceIsSecure();

        if (!biometricEnrolled && !deviceSecure) {
            call.reject("No screen lock or biometric is set up on this device", "NOT_AVAILABLE");
            return;
        }

        int authenticators;
        if (biometricEnrolled && deviceSecure) {
            authenticators = BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
        } else if (deviceSecure) {
            authenticators = BiometricManager.Authenticators.DEVICE_CREDENTIAL;
        } else {
            // Biometric enrolled without a secure lockscreen. The platform
            // normally requires a lockscreen before biometric enrollment,
            // so this branch is defensive.
            authenticators = BiometricManager.Authenticators.BIOMETRIC_WEAK;
        }

        BiometricPrompt.PromptInfo.Builder builder = new BiometricPrompt.PromptInfo.Builder()
            .setTitle(call.getString("title", "Verify your identity"))
            .setAllowedAuthenticators(authenticators);

        String subtitle = call.getString("subtitle");
        if (subtitle != null && !subtitle.isEmpty()) {
            builder.setSubtitle(subtitle);
        }
        String description = call.getString("description");
        if (description != null && !description.isEmpty()) {
            builder.setDescription(description);
        }

        // A negative button may only be set when device-credential fallback
        // is NOT allowed; with the fallback, its slot is taken by the
        // system's "use PIN" affordance and build() would throw.
        if ((authenticators & BiometricManager.Authenticators.DEVICE_CREDENTIAL) == 0) {
            builder.setNegativeButtonText(call.getString("negativeButtonText", "Cancel"));
        }

        final BiometricPrompt.PromptInfo promptInfo;
        try {
            promptInfo = builder.build();
        } catch (IllegalArgumentException e) {
            call.reject("Invalid authentication prompt configuration: " + e.getMessage());
            return;
        }

        FragmentActivity activity = getActivity();
        if (activity == null) {
            call.reject("Activity not available");
            return;
        }

        Executor executor = ContextCompat.getMainExecutor(getContext());
        activity.runOnUiThread(() ->
            new BiometricPrompt(
                activity,
                executor,
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        JSObject ret = new JSObject();
                        ret.put("verified", true);
                        call.resolve(ret);
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, CharSequence errString) {
                        call.reject(
                            errString != null ? errString.toString() : "Authentication error",
                            String.valueOf(errorCode)
                        );
                    }
                    // onAuthenticationFailed (a single non-matching read) is
                    // intentionally not overridden: the system sheet stays up
                    // and handles retries and lockout on its own.
                }
            ).authenticate(promptInfo)
        );
    }

    /** Class-2 or class-3 biometric enrolled and usable right now. */
    private boolean biometricEnrolled() {
        BiometricManager biometricManager = BiometricManager.from(getContext());
        return biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS;
    }

    /** Lockscreen PIN, pattern, or password configured. */
    private boolean deviceIsSecure() {
        KeyguardManager keyguardManager = (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
        return keyguardManager != null && keyguardManager.isDeviceSecure();
    }

    /**
     * Display-only hint for UI copy. Hardware features do not reveal which
     * biometric is actually enrolled, so this stays a best-effort label;
     * availability decisions must use the booleans above.
     */
    private String resolveBiometryType(boolean biometricEnrolled, boolean deviceSecure) {
        if (!biometricEnrolled) {
            return deviceSecure ? "device-pin" : "none";
        }

        PackageManager pm = getContext().getPackageManager();
        boolean hasFingerprint = pm.hasSystemFeature(PackageManager.FEATURE_FINGERPRINT);
        boolean hasFace = pm.hasSystemFeature(PackageManager.FEATURE_FACE);
        boolean hasIris = pm.hasSystemFeature(PackageManager.FEATURE_IRIS);

        int typeCount = (hasFingerprint ? 1 : 0) + (hasFace ? 1 : 0) + (hasIris ? 1 : 0);
        if (typeCount > 1) return "multiple";
        if (hasFace) return "face";
        if (hasIris) return "iris";
        return "fingerprint";
    }
}
