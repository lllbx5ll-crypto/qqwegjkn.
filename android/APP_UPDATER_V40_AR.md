# NEXBOTS Android v4.0 — Native APK Updater

The native WebView app (package `dev.nexbots.android`) now exposes two origin-restricted bridge messages:

- `getAppVersion` returns the installed Android `versionCode` and `versionName` to NEXBOTS website JS.
- `installAppUpdate` accepts only `https://nexbots.pages.dev/api/app-release/apk` with expected file length, SHA-256 and a versionCode strictly greater than the installed package.

On a user-initiated tap, Android DownloadManager downloads the APK to its app-specific downloads folder. The app validates exact size, SHA-256, package name, embedded versionCode **and the APK signing certificate against the installed version** before opening Android Package Installer via a private FileProvider content URI. Android always asks for permission/confirmation to install. The user does not need to hunt for an APK in their file manager.

If the application lacks installation-from-this-source permission, we present Android's official system permission screen. We do not silently install APKs or bypass Android's security requirements.

### Important release-signing limitation

The current repository's GitHub workflow uses a temporary debug keystore when the `NEXBOTS_TEST_KEYSTORE_B64` secret is not configured. Such APKs **cannot update a previously installed APK signed with a different debug certificate**. Do not distribute this build as a stable public update until a **permanent release-signing key** is configured and securely backed up. For end users upgrading from an older incompatible signing key, a one-time manual migration or package reinstall may be necessary; uninstalling can erase local app data.

Gradle's new package version is `4.0.0`, code `6`. When publishing its APK in the website owner's release dashboard, use the actual embedded version code and name; future versions MUST use a larger versionCode. Keep the website's `assetlinks.json` aligned with the installed APK's signing certificate for Android App Links.

### Distribution

This self-update workflow is for the owner's **direct website APK distribution**. If NEXBOTS is later distributed through Google Play, review Google Play's REQUEST_INSTALL_PACKAGES policy and migrate updates to Google Play's permitted in-app update APIs instead.

### What this does NOT do

- No silent installations, forced changes to device permissions, or updates without a user-confirmed install.
- No changes to Google Sign-In, FCM push, stories, project downloads or Firebase rules.
- The existing APK v3.7 does not contain this native updater bridge; users must install v4.0 once through Android's normal installer before future one-tap updates can work.
