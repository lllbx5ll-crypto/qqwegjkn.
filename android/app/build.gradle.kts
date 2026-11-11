plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}
android {
    namespace = "dev.nexbots.android"
    compileSdk = 35
    defaultConfig {
        applicationId = "dev.nexbots.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 5
        versionName = "3.6.0"
    }
    // A single TEST debug key keeps the Firebase SHA fingerprints stable between builds.
    // Never commit app/debug.keystore; keep it private. Release/Play needs its own key.
    signingConfigs {
        getByName("debug") {
            val testKey = file("debug.keystore")
            if (testKey.exists()) {
                storeFile = testKey
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }
    buildTypes { release { isMinifyEnabled = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation(platform("com.google.firebase:firebase-bom:35.0.2"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
}
