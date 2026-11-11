# NEXBOTS — تسجيل Google الحقيقي وتوقيع APK التجريبي

لقد سجلت تطبيق أندرويد في Firebase وحساب Google مفعّل. لم تضف بعد SHA (بحسب الصورة الأخيرة).

## بصمات المفتاح التجريبي لهذا المشروع (فقط إذا استخدمت المفتاح المرفق)

SHA-1:
`DB:6C:2B:44:49:6D:1A:08:10:BB:7A:A6:2B:E1:2B:AF:15:A9:5B:DA`

SHA-256:
`F7:D4:7E:FD:C5:F4:49:47:FC:E8:06:25:C7:A8:08:57:72:19:C6:7A:F2:D4:1C:1B:C3:90:8A:3B:B9:B7:EB:AA`

**مهم جداً:** هذه البصمات لا تعمل إلا إذا وقع APK بنفس ملف `NEXBOTS_TEST_DEBUG_SIGNING_ONLY.keystore`. نسخ APK من Android Studio أو Google Play بمفتاح مختلف تحتاج بصمات المفتاح الفعلي.

## استخدام نفس مفتاح التجربة في Android Studio
1. نزّل ملف `NEXBOTS_TEST_DEBUG_SIGNING_ONLY.keystore` المرسل بشكل منفصل واحتفظ به خاصاً.
2. انسخه إلى مجلد مشروع Android في `app/debug.keystore` (غيّر الاسم فقط لا محتوى الملف).
3. كود Gradle في هذا المشروع مهيأ لاستخدام هذا المفتاح في نسخ debug عند وجود الملف.
4. لا ترفع المفتاح إلى GitHub عام، ولا تعتمد عليه لتوقيع إصدار الإنتاج.

## إضافة البصمات من الهاتف
1. افتح Firebase Console > Project settings > General > Your apps > Android: NEXBOTS.
2. اضغط `+ Add fingerprint`، والصق SHA-1 أعلاه ثم احفظ.
3. اضغط `+ Add fingerprint` ثانية، والصق SHA-256 واحفظ.
4. نزّل `google-services.json` المحدث من الصفحة نفسها (سيحتوي على OAuth Android client المناسب)، واستبدل `app/google-services.json` في مشروع Android، وحدّث secret إن كنت تستخدم GitHub Actions.
5. اختبر تسجيل Google في APK تجريبي موقع بنفس المفتاح. استخدم نفس حساب Google في الموقع والتطبيق، فتكون هوية Firebase UID نفسها.

## GitHub Actions من الهاتف
يعتمد `.github/workflows/build-debug-apk.yml` على ثلاثة GitHub Secrets:
- `FIREBASE_ANDROID_JSON_B64` = محتوى google-services.json المحدّث بعد تحويله إلى Base64.
- `GOOGLE_WEB_CLIENT_ID` = Web OAuth Client ID الموجود في Firebase (ليس مفتاح API).
- `NEXBOTS_TEST_KEYSTORE_B64` = محتوى ملف الاختبار `.keystore` بعد تحويله إلى Base64.

هذه الأسرار لا توضع في الملفات العامة. Workflow يتحقق من وجود المفتاح ويطبع بصماته للتأكد من تطابق Firebase، ثم ينتج APK للتجربة عبر GitHub Actions Artifacts.

**للإنتاج:** ستحتاج keystore خاصاً وآمناً للإصدار النهائي، وإضافة بصمته. إذا نشرت عبر Google Play App Signing أضف شهادة توقيع التطبيق من Play Console أيضاً. مفاتيح نسخة التجربة ليست للنشر النهائي.

**حدود ما تم التحقق منه هنا:** تم اختبار كود الموقع آلياً ولم يتوفر Android SDK/Gradle لبناء APK وتشغيله على هاتف. تشغيل إشعارات الخادم يحتاج إعداد Cloudflare وFCM حسب دليل الموقع.
