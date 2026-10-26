# Keep JavascriptInterface methods from being obfuscated or removed in release builds
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
