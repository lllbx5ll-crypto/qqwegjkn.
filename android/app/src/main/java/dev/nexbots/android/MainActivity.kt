package dev.nexbots.android

import android.Manifest
import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.NoCredentialException
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

/** Native NEXBOTS companion: dynamic website + Android capabilities.
 * Only HTTPS nexbots.pages.dev can call the native bridge. Never load unknown
 * origins in our WebView, never expose account tokens to external applications.
 */
class MainActivity : ComponentActivity() {
    private val base = "https://nexbots.pages.dev"
    private val domain = "nexbots.pages.dev"
    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private var currentNotice: TextView? = null
    private var offlineMode = false
    private var lastPagePath = "/"
    private val connectivity by lazy { getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager }
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onLost(network: Network) {
            runOnUiThread {
                if (::web.isInitialized && !isNetworkAvailable()) {
                    showOffline()
                    showTopMessage("انقطع الاتصال. بعض الخدمات غير متاحة الآن.")
                }
            }
        }
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
                runOnUiThread { if (::root.isInitialized && offlineMode) showTopMessage("عاد الاتصال. اضغط إعادة المحاولة للمتابعة.") }
            }
        }
    }
    private val handler = Handler(Looper.getMainLooper())
    private val downloads = linkedMapOf<String, Long>()
    private var uploadResult: ValueCallback<Array<Uri>>? = null
    private val chooseFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        uploadResult?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        uploadResult = null
    }
    private val requestNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) Toast.makeText(this, "يمكن تفعيل الإشعارات من إعدادات التطبيق لاحقاً", Toast.LENGTH_LONG).show()
    }
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
            val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
            val requestId = downloads.entries.find { it.value == id }?.key ?: return
            // ACTION_DOWNLOAD_COMPLETE also fires for FAILED downloads; do not
            // claim success without checking DownloadManager's actual status.
            pollDownload(requestId, id)
        }
    }
    private val deviceId by lazy {
        val prefs = getSharedPreferences("nexbots_android", MODE_PRIVATE)
        prefs.getString("device_id", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("device_id", it).apply() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        createNotificationChannels()
        root = FrameLayout(this)
        web = WebView(this)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true // Required to display our packaged android_asset offline.html
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = false
            useWideViewPort = true
            loadWithOverviewMode = true
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        WebView.setWebContentsDebuggingEnabled(false)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "NexbotsAndroid", setOf(base)) { _, msg, origin, mainFrame, _ ->
                if (!mainFrame || origin.toString() != base) return@addWebMessageListener
                val payload = try { JSONObject(msg.data ?: "") } catch (_: Exception) { return@addWebMessageListener }
                runOnUiThread {
                    when (payload.optString("action")) {
                        "googleSignIn" -> payload.optString("requestId").take(96).takeIf { it.isNotEmpty() }?.let { googleSignIn(it) }
                        "openExternal" -> openExternal(payload.optString("url"))
                        "downloadProject" -> startDownload(payload)
                        "openDownload" -> openDownload(payload.optString("requestId"))
                        "requestPushToken" -> sendPushToken()
                    }
                }
            }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.scheme == "https" && uri.host == domain) return false
                if (request.isForMainFrame) openExternal(uri.toString())
                return true
            }
            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                super.doUpdateVisitedHistory(view, url, isReload)
                rememberPath(url)
            }
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                if (Uri.parse(url).host == domain) {
                    offlineMode = false
                    rememberPath(url)
                    sendPushToken()
                }
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame && request.url.host == domain) {
                    if (error.errorCode == ERROR_FAILED_SSL_HANDSHAKE) {
                        showTopMessage("تعذّر تأمين الاتصال بالخادم. حاول مجددًا لاحقًا.")
                    } else {
                        showOffline()
                        showTopMessage("تعذّر تحميل الصفحة. تحقق من الاتصال ثم أعد المحاولة.")
                    }
                }
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView?, callback: ValueCallback<Array<Uri>>?, params: FileChooserParams?): Boolean {
                uploadResult?.onReceiveValue(null)
                uploadResult = callback
                return try { chooseFile.launch(requireNotNull(params).createIntent()); true }
                catch (_: Exception) { uploadResult?.onReceiveValue(null); uploadResult = null; false }
            }
            override fun onCreateWindow(view: WebView?, dialog: Boolean, gesture: Boolean, result: android.os.Message?): Boolean {
                if (!gesture || result == null) return false
                val popup = WebView(this@MainActivity)
                popup.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        openExternal(request.url.toString())
                        popup.post { popup.destroy() }
                        return true
                    }
                }
                (result.obj as WebView.WebViewTransport).webView = popup
                result.sendToTarget()
                return true
            }
        }
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        lastPagePath = safePath(intent?.getStringExtra("path"))
        if (isNetworkAvailable()) web.loadUrl(base + lastPagePath) else showOffline()
        try { connectivity.registerDefaultNetworkCallback(networkCallback) } catch (_: Exception) { /* WebView error handling is the fallback. */ }
        @Suppress("DEPRECATION")
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), Context.RECEIVER_NOT_EXPORTED)
        else registerReceiver(receiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE))
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        FirebaseMessaging.getInstance().subscribeToTopic("nexbots_announcements")
    }

    private fun safePath(path: String?): String = if (path != null && (path == "/private" || path == "/" || Regex("/private/t/[A-Za-z0-9_-]{1,80}").matches(path) || Regex("/project/[A-Za-z0-9_-]{1,128}").matches(path)) && !path.contains("//") && !path.contains("..")) path else "/"

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.getStringExtra("path")?.let {
            lastPagePath = safePath(it)
            if (isNetworkAvailable()) web.loadUrl(base + lastPagePath) else showOffline()
        }
    }

    private fun rememberPath(url: String?) {
        val uri = try { Uri.parse(url) } catch (_: Exception) { return }
        if (uri?.scheme == "https" && uri.host == domain) {
            // Preserve the last page, but never cache its contents or any account tokens.
            val route = uri.encodedPath ?: "/"
            if (route.length < 320 && !route.contains("..") && !route.contains("//")) lastPagePath = route
        }
    }

    private fun isNetworkAvailable(): Boolean {
        val net = connectivity.activeNetwork ?: return false
        val caps = connectivity.getNetworkCapabilities(net) ?: return false
        // INTERNET alone also exists on captive / disconnected networks.
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun showOffline() {
        if (!::web.isInitialized || isFinishing) return
        offlineMode = true
        val requested = if (lastPagePath in setOf("/", "/explore", "/chat", "/private", "/account")) lastPagePath else "/"
        web.loadUrl("file:///android_asset/offline.html?path=" + Uri.encode(requested))
    }

    private fun showTopMessage(message: String) {
        if (!::root.isInitialized || isFinishing) return
        currentNotice?.let { root.removeView(it) }
        val banner = TextView(this).apply {
            text = message
            textDirection = TextView.TEXT_DIRECTION_RTL
            gravity = Gravity.CENTER
            textSize = 14f
            setTextColor(Color.WHITE)
            setPadding(dp(19), dp(15), dp(19), dp(15))
            background = GradientDrawable().apply {
                setColor(Color.rgb(46, 24, 69))
                cornerRadius = dp(16).toFloat()
                setStroke(dp(1), Color.rgb(163, 103, 229))
            }
            elevation = dp(14).toFloat()
        }
        val params = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP).apply {
            setMargins(dp(14), dp(14), dp(14), 0)
        }
        root.addView(banner, params)
        currentNotice = banner
        handler.postDelayed({ if (::root.isInitialized && currentNotice === banner) {
            root.removeView(banner)
            currentNotice = null
        } }, 4000)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density + 0.5f).toInt()

    private fun emit(name: String, data: JSONObject) {
        if (Uri.parse(web.url ?: "").host != domain) return
        val safeName = JSONObject.quote(name)
        val safeValue = JSONObject.quote(data.toString())
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent($safeName,{detail:JSON.parse($safeValue)}));", null)
    }

    private fun sendPushToken() {
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            emit("nexbots-native-push-token", JSONObject().put("token", token).put("deviceId", deviceId))
        }
    }

    private fun startDownload(payload: JSONObject) {
        val url = payload.optString("url")
        val requestId = payload.optString("requestId").take(96)
        val bearer = payload.optString("idToken")
        val filename = payload.optString("filename").substringAfterLast('/').replace(Regex("[^\\w.() -]"), "_").take(100).ifBlank { "nexbots-project.zip" }
        val uri = try { Uri.parse(url) } catch (_: Exception) { null }
        if (requestId.isEmpty() || uri?.scheme != "https" || uri.host != domain ||
            !Regex("/api/download/[A-Za-z0-9_-]{1,128}").matches(uri.path ?: "") || uri.query != null || bearer.length < 100) {
            emit("nexbots-native-download", JSONObject().put("requestId", requestId).put("state", "error").put("error", "طلب التنزيل غير صالح"))
            return
        }
        if (!isNetworkAvailable()) {
            showTopMessage("تعذّر بدء التنزيل. تحقق من الاتصال ثم أعد المحاولة.")
            emit("nexbots-native-download", JSONObject().put("requestId", requestId).put("state", "error").put("error", "لا يوجد اتصال بالإنترنت"))
            return
        }
        try {
            val dm = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
            val req = DownloadManager.Request(uri).apply {
                setTitle(filename)
                setDescription("تنزيل مشروع من NEXBOTS")
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setAllowedOverMetered(true)
                setAllowedOverRoaming(false)
                addRequestHeader("Authorization", "Bearer $bearer")
                setMimeType(fileMime(filename))
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, uniqueName(filename))
            }
            val downloadId = dm.enqueue(req)
            downloads[requestId] = downloadId
            pollDownload(requestId, downloadId)
        } catch (_: Exception) {
            showTopMessage("تعذّر بدء التنزيل، حاول مجددًا.")
            emit("nexbots-native-download", JSONObject().put("requestId", requestId).put("state", "error").put("error", "تعذر بدء التنزيل على الجهاز"))
        }
    }

    private fun pollDownload(requestId: String, downloadId: Long) {
        val dm = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
        try {
            dm.query(DownloadManager.Query().setFilterById(downloadId))?.use { cursor ->
                if (!cursor.moveToFirst()) return
                val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                val bytes = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                val total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                val progress = if (total > 0) ((bytes * 100L) / total).toInt().coerceIn(0, 100) else 0
                val state = when (status) {
                    DownloadManager.STATUS_SUCCESSFUL -> "done"
                    DownloadManager.STATUS_FAILED -> "error"
                    else -> "progress"
                }
                val event = JSONObject().put("requestId", requestId).put("state", state).put("progress", progress)
                if (state == "error") {
                    event.put("error", "فشل التنزيل؛ تحقق من اتصال الإنترنت أو صلاحية الملف")
                    showTopMessage("لم يكتمل التنزيل. حاول مجددًا.")
                }
                emit("nexbots-native-download", event)
                if (state == "progress" && !isFinishing) handler.postDelayed({ pollDownload(requestId, downloadId) }, 500)
                return
            }
        } catch (_: Exception) {
            emit("nexbots-native-download", JSONObject().put("requestId", requestId).put("state", "error").put("error", "تعذر متابعة التنزيل"))
        }
    }

    private fun openDownload(requestId: String) {
        // "فتح" means open the Downloads manager, not launch the ZIP or a random
        // editor. The user can see the actual saved file in Downloads.
        val id = downloads[requestId]
        if (id == null) {
            showTopMessage("لم يتم العثور على التنزيل في الجهاز.")
            return
        }
        val dm = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
        val complete = try {
            dm.query(DownloadManager.Query().setFilterById(id))?.use { cursor ->
                cursor.moveToFirst() && cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) == DownloadManager.STATUS_SUCCESSFUL
            } ?: false
        } catch (_: Exception) { false }
        if (!complete) {
            showTopMessage("الملف لم يكتمل تنزيله بعد.")
            return
        }
        try {
            startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS))
        } catch (_: ActivityNotFoundException) {
            // Some Android variants do not expose the Downloads UI.
            try {
                startActivity(Intent(Intent.ACTION_OPEN_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("*/*"))
            } catch (_: Exception) {
                showTopMessage("تعذّر فتح التنزيلات. افتحها من مدير الملفات.")
            }
        } catch (_: Exception) {
            showTopMessage("تعذّر فتح التنزيلات. افتحها من مدير الملفات.")
        }
    }

    private fun uniqueName(filename: String): String {
        // Distinct name even if this project is downloaded more than once.
        val dot = filename.lastIndexOf('.')
        val head = if (dot > 0) filename.substring(0, dot) else filename
        val suffix = if (dot > 0) filename.substring(dot) else ""
        return "$head (${System.currentTimeMillis() % 1000000})$suffix"
    }

    private fun fileMime(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
        "zip" -> "application/zip"; "pdf" -> "application/pdf"
        "json" -> "application/json"; "js", "ts", "jsx", "tsx", "py", "php", "txt" -> "text/plain"
        else -> "application/octet-stream"
    }

    private fun openExternal(link: String) {
        try {
            val uri = Uri.parse(link)
            val scheme = uri.scheme?.lowercase() ?: return
            if (scheme !in setOf("https", "http", "mailto", "tel", "whatsapp", "tg")) return
            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (_: Exception) {
            showTopMessage("تعذّر فتح الرابط. تحقق من توفر التطبيق المطلوب.")
        }
    }

    private fun googleSignIn(requestId: String) {
        if (!isNetworkAvailable()) {
            showTopMessage("تعذّر تسجيل الدخول. تحقق من الاتصال.")
            emit("nexbots-native-google-response", JSONObject().put("requestId", requestId).put("error", "لا يوجد اتصال بالإنترنت"))
            return
        }
        val clientId = getString(R.string.google_web_client_id)
        if (clientId.startsWith("PUT_")) {
            emit("nexbots-native-google-response", JSONObject().put("requestId", requestId).put("error", "يحتاج التطبيق إلى إعداد Google Client ID"))
            return
        }
        lifecycleScope.launch {
            try {
                val option = GetSignInWithGoogleOption.Builder(serverClientId = clientId).build()
                val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
                val credential = CredentialManager.create(this@MainActivity).getCredential(this@MainActivity, request).credential
                if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                    emit("nexbots-native-google-response", JSONObject().put("requestId", requestId).put("error", "لم يتم اختيار حساب Google صالح")); return@launch
                }
                val token = GoogleIdTokenCredential.createFrom(credential.data).idToken
                emit("nexbots-native-google-response", JSONObject().put("requestId", requestId).put("idToken", token))
            } catch (error: GetCredentialException) {
                // The old generic error concealed OAuth/signing problems after account selection.
                // Log only the exception class/type, NEVER the Google ID token.
                android.util.Log.w("NEXBOTS.GoogleSignIn", "Credential Manager: ${error.javaClass.simpleName}; type=${error.type}")
                val message = when (error) {
                    is GetCredentialCancellationException ->
                        "توقفت عملية اختيار حساب Google. إذا اخترت حساباً ولم تلغِ العملية، تأكد من إضافة بصمة SHA-1 الخاصة بتوقيع APK في Firebase."
                    is GetCredentialProviderConfigurationException ->
                        "تعذّر تشغيل مزود تسجيل Google. حدّث خدمات Google Play، وتأكد من إعداد تطبيق Android في Firebase."
                    is NoCredentialException ->
                        "لم يتم العثور على حساب Google متاح. أضف حساباً للهاتف وحاول مجدداً."
                    else ->
                        "تعذّر تسجيل Google (${error.javaClass.simpleName}). تحقق من بصمة SHA-1 وGoogle OAuth في Firebase."
                }
                emit("nexbots-native-google-response", JSONObject().put("requestId", requestId).put("error", message))
            } catch (error: Exception) {
                android.util.Log.e("NEXBOTS.GoogleSignIn", "Google sign-in failed: ${error.javaClass.simpleName}")
                emit("nexbots-native-google-response", JSONObject().put("requestId", requestId).put("error", "تعذّر إتمام تسجيل Google. تأكد من إعدادات OAuth أو جرّب تحديث خدمات Google Play."))
            }
        }
    }

    private fun createNotificationChannels() {
        val service = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        service.createNotificationChannel(NotificationChannel("nexbots_messages", "الرسائل الخاصة", NotificationManager.IMPORTANCE_HIGH).apply { description = "إشعار عند وصول رسالة خاصة" })
        service.createNotificationChannel(NotificationChannel("nexbots_announcements", "إعلانات NEXBOTS", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "إشعارات إعلانات إدارة المنصة" })
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else super.onBackPressed() }
    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        try { unregisterReceiver(receiver) } catch (_: Exception) {}
        uploadResult?.onReceiveValue(null); uploadResult = null
        try { connectivity.unregisterNetworkCallback(networkCallback) } catch (_: Exception) {}
        web.destroy()
        super.onDestroy()
    }
}
