package dev.nexbots.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** FCM handles background notification payloads; foreground messages are displayed here. */
class NexbotsMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        getSharedPreferences("nexbots_android", MODE_PRIVATE).edit().putString("fcm_token", token).apply()
    }
    override fun onMessageReceived(message: RemoteMessage) {
        // In background, FCM already displays the notification payload. This code
        // covers foreground messages (without duplicating notifications).
        val title = message.notification?.title ?: "NEXBOTS"
        val body = message.notification?.body ?: "لديك إشعار جديد"
        val isMessage = message.data["type"] == "private"
        val channel = if (isMessage) "nexbots_messages" else "nexbots_announcements"
        val mgr = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            mgr.createNotificationChannel(NotificationChannel(channel, if (isMessage) "الرسائل الخاصة" else "الإعلانات", if (isMessage) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_DEFAULT))
        }
        val threadId = message.data["threadId"].orEmpty()
        val destination = if (isMessage && Regex("[A-Za-z0-9_-]{1,80}").matches(threadId)) "/private/t/$threadId" else if (isMessage) "/private" else "/"
        val intent = Intent(this, MainActivity::class.java).putExtra("path", destination)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(this, (System.currentTimeMillis() % Int.MAX_VALUE).toInt(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, channel)
            .setSmallIcon(R.drawable.ic_stat_nexbots)
            .setContentTitle(title).setContentText(body).setAutoCancel(true)
            .setContentIntent(pending)
            .setPriority(if (isMessage) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT).build()
        mgr.notify((System.nanoTime() % Int.MAX_VALUE).toInt(), notification)
    }
}
