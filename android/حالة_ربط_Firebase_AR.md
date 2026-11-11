# NEXBOTS Android v3.1 — تحديث الربط مع Firebase

تم دمج ملف `google-services.json` الذي أرسله مالك المشروع في المسار الصحيح `app/google-services.json`، وتعبئة معرّف Google Web OAuth داخل `app/src/main/res/values/strings.xml`.

التحقق: اسم الحزمة `dev.nexbots.android` والمشروع `exbots` يطابقان تعريف التطبيق وملف موقع NEXBOTS. إضافة Google Services ومكتبة Firebase Messaging موجودتان بالفعل في ملفات Gradle.

## ماذا بقي قبل نجاح التسجيل والإشعارات؟

1. في Firebase Console ← Build/Authentication ← Sign-in method، فعّل Google، وحدد بريد دعم المشروع إذا طُلب.
2. في Firebase Console ← Project settings ← General ← Your apps ← تطبيق Android، أضف SHA-1 وSHA-256 لشهادة توقيع **النسخة التي ستثبتها فعلاً** (debug أو release). بعد الإضافة أعد تنزيل `google-services.json` عند الحاجة واستبدل القديم.
3. افتح مشروع أندرويد في Android Studio، وتأكد من تنزيل Gradle/SDK وأن البناء يكتمل. لم يُبنَ APK داخل هذه المحادثة ولم يُختبر التشغيل على جهاز.
4. فعّل إعداد إشعارات الخادم عبر Cloudflare KV والمتغير السري `FCM_SERVICE_ACCOUNT_JSON` وفق `SETUP_PUSH_CLOUDFLARE_AR.md` في ملف الموقع المرفوع سابقاً. ملف google-services.json **ليس** ملف حساب الخدمة السري ولا يكفي وحده لإرسال إشعارات.
5. انشر نسخة الموقع المتوافقة على Cloudflare وجرب تسجيل Google ثم إشعارات رسائل حقيقية وإعلانات عامة على هاتف.

ملاحظة: ملف `app/google-services.json` مستثنى في `.gitignore` للمستودعات؛ عند بناء المشروع عبر GitHub Actions، يلزم ضبط أسرار `FIREBASE_ANDROID_JSON_B64` و `GOOGLE_WEB_CLIENT_ID` كما في الـworkflow.

**لا ترفع بيانات Service Account السرية في GitHub أو المحادثات العامة.**
