package com.example.guessthesong

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var pendingSpotifyCode: String? = null

    companion object {
        // Virtuelle HTTPS-Domain für den WebViewAssetLoader (ermöglicht problemloses fetch() auf lokale Assets)
        private const val LOCAL_START_URL = "https://appassets.androidplatform.net/assets/index.html"
        private const val REDIRECT_URI_PREFIX = "https://guessthesong.local"
    }

    /**
     * JavascriptInterface, über das die JavaScript-Dateien (spotify.js, ki-tipps.js)
     * sicher auf die aus local.properties generierten BuildConfig-Keys zugreifen können.
     */
    inner class WebAppInterface {
        @JavascriptInterface
        fun getSpotifyClientId(): String {
            return BuildConfig.SPOTIFY_CLIENT_ID
        }

        @JavascriptInterface
        fun getGeminiApiKey(): String {
            return BuildConfig.GEMINI_API_KEY
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)

        // 1. WebViewAssetLoader einrichten: bildet https://appassets.androidplatform.net/assets/...
        // direkt auf den lokalen Android-Assets-Ordner (app/src/main/assets/) ab.
        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        // 2. CookieManager & Third-Party-Cookies für den Spotify-Login aktivieren
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true)

        // 3. WebView-Einstellungen konfigurieren
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true

            // Medien-Autoplay ohne Nutzer-Geste erlauben (wichtig für Spotify Web Playback SDK)
            mediaPlaybackRequiresUserGesture = false

            allowFileAccess = true
            allowContentAccess = true

            loadWithOverviewMode = true
            useWideViewPort = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }

        // 4. JavascriptInterface unter dem Namen "Android" bereitstellen
        webView.addJavascriptInterface(WebAppInterface(), "Android")

        // 5. WebViewClient für Asset-Loading (fetch) und Spotify-Redirect-Abfangen
        webView.webViewClient = object : WebViewClient() {

            // Fängt alle Anfragen an https://appassets.androidplatform.net/assets/... ab
            // und liefert die lokalen Dateien (HTML, CSS, JS, JSON, GIFs) per Stream aus.
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val uri = request?.url ?: return null
                return assetLoader.shouldInterceptRequest(uri)
                    ?: super.shouldInterceptRequest(view, request)
            }

            @Deprecated("Deprecated in Java")
            override fun shouldInterceptRequest(
                view: WebView?,
                url: String?
            ): WebResourceResponse? {
                val uri = url?.let { Uri.parse(it) } ?: return null
                return assetLoader.shouldInterceptRequest(uri)
                    ?: super.shouldInterceptRequest(view, url)
            }

            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val uri = request?.url ?: return false
                return handleInterceptedUri(view, uri)
            }

            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                val uri = url?.let { Uri.parse(it) } ?: return false
                return handleInterceptedUri(view, uri)
            }

            private fun handleInterceptedUri(view: WebView?, uri: Uri): Boolean {
                val urlString = uri.toString()

                // Spotify Redirect abfangen: https://guessthesong.local/?code=...
                if (urlString.startsWith(REDIRECT_URI_PREFIX)) {
                    val code = uri.getQueryParameter("code")
                    if (!code.isNullOrEmpty()) {
                        pendingSpotifyCode = code
                    }

                    // Lokale App über die AssetLoader-URL wieder laden (verhindert Fehlerseite)
                    view?.loadUrl(LOCAL_START_URL)
                    return true
                }

                // Externe Spotify-Track-Links (z.B. Klick auf Cover oder Bibliothek) in der Spotify-App/Browser öffnen
                if (urlString.startsWith("https://open.spotify.com/") || urlString.startsWith("spotify:")) {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                    } catch (_: Exception) {
                    }
                    return true
                }

                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                CookieManager.getInstance().flush()

                // Sobald nach dem Redirect wieder index.html geladen ist, den Code an spotify.js übergeben
                if (url != null && url.startsWith(LOCAL_START_URL)) {
                    val codeToDeliver = pendingSpotifyCode
                    if (!codeToDeliver.isNullOrEmpty()) {
                        pendingSpotifyCode = null
                        val safeJsString = JSONObject.quote(codeToDeliver)
                        view?.evaluateJavascript(
                            "if (typeof handleSpotifyRedirectCode === 'function') { handleSpotifyRedirectCode($safeJsString); }",
                            null
                        )
                    }
                }
            }
        }

        // 6. WebChromeClient (erlaubt u.a. Protected Media / Widevine DRM für das Spotify Web Playback SDK)
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                request?.grant(request.resources)
            }
        }

        // Startseite über WebViewAssetLoader laden
        if (savedInstanceState == null) {
            webView.loadUrl(LOCAL_START_URL)
        }

        // Zurück-Button/Geste behandeln
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onRestoreInstanceState(savedInstanceState: Bundle) {
        super.onRestoreInstanceState(savedInstanceState)
        webView.restoreState(savedInstanceState)
    }
}
