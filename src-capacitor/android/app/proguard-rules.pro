# R8 / ProGuard rules for the release build (minifyEnabled true).
#
# Everything kept below is reached by NAME, not by a Java reference: the
# Capacitor bridge resolves plugin classes, their @PluginMethod entry points
# and their callbacks reflectively from JavaScript, so R8 sees no caller and
# would happily rename or delete all of it. A missing keep rule here does not
# fail the build - it fails at runtime, in a release build, on a user's phone.
# Add to this file rather than turning minification back off.

# ── Capacitor bridge ──────────────────────────────────────────────────────
# The bridge itself reflects over plugin classes, JSObject/JSArray payloads
# and method names, so it is kept whole rather than rule by rule.
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }

# Every plugin (BuhoGO's own and the packaged ones): the class is looked up by
# name, the @PluginMethod methods are invoked by name, and the annotations
# carry the plugin name the JavaScript side asks for.
-keep public class * extends com.getcapacitor.Plugin { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public *;
    @com.getcapacitor.annotation.ActivityCallback *;
    @com.getcapacitor.annotation.PermissionCallback *;
}

# Annotation values (plugin names, permission aliases) must survive.
-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod

# Cordova-bridged plugins are instantiated from the class names in plugin.xml.
-keep class org.apache.cordova.** { *; }
-keep public class * extends org.apache.cordova.CordovaPlugin { *; }

# ── WebView ↔ Java ────────────────────────────────────────────────────────
# @JavascriptInterface methods have no Java caller by definition.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ── Crash reports ─────────────────────────────────────────────────────────
# Keep line numbers so Play's deobfuscated stack traces stay readable, and
# hide the original file names (the mapping file, uploaded with the bundle,
# is what turns them back).
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ── Notes ─────────────────────────────────────────────────────────────────
# ML Kit, play-services, androidx and the Play in-app-update library all ship
# their own consumer rules; they need nothing here. If a release build stops
# with "Missing class ..." R8 writes the exact rules it wants to
# app/build/outputs/mapping/release/missing_rules.txt - copy the ones that
# apply into this file rather than adding a blanket -dontwarn.
