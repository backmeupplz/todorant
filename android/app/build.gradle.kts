import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.todorant"
    compileSdk = 37
    defaultConfig {
        applicationId = "com.todorant"
        minSdk = 26
        targetSdk = 36
        // RN builds used ABI-split codes up to 4 * 1048576 + 173; stay above them so this installs as an update.
        versionCode = 5_000_011
        versionName = "2.2.9"
        // Backend (REST + /v2/ws sync); `./gradlew -Papi=http://localhost:1337 ...` for a local one
        buildConfigField("String", "API", "\"${project.findProperty("api") ?: "https://backend.todorant.com"}\"")
    }
    buildFeatures { compose = true; buildConfig = true }
    // F-Droid rejects APKs carrying Google's encrypted dependency block, which blocks reproducible builds there. Play still gets it from the bundle.
    dependenciesInfo { includeInApk = false }
    // play: Google sign-in and Google's QR scanner. fdroid: no Google code (ZXing scanner, no Google sign-in). See src/<flavor>/Flavor.kt.
    flavorDimensions += "store"
    productFlavors {
        create("play") { dimension = "store" }
        create("fdroid") { dimension = "store" }
    }
    // Play upload key lives outside the repo; without it release builds are unsigned.
    val upload = Properties().apply {
        val f = file("${System.getProperty("user.home")}/.android/todorant-upload.properties")
        if (f.exists()) f.inputStream().use(::load)
    }
    signingConfigs {
        if (upload.isNotEmpty()) create("upload") {
            storeFile = file(upload.getProperty("storeFile"))
            storePassword = upload.getProperty("storePassword")
            keyAlias = upload.getProperty("keyAlias")
            keyPassword = upload.getProperty("keyPassword")
        }
    }
    buildTypes {
        debug { applicationIdSuffix = ".debug" }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("upload")
            // `-Pqa` makes a release build inspectable with run-as for device QA
            isDebuggable = project.hasProperty("qa")
        }
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.navigation:navigation-compose:2.10.2")
    implementation("sh.calvin.reorderable:reorderable:3.1.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    "playImplementation"("androidx.credentials:credentials:1.6.0")
    "playImplementation"("androidx.credentials:credentials-play-services-auth:1.6.0")
    "playImplementation"("com.google.android.libraries.identity.googleid:googleid:1.2.1")
    "playImplementation"("com.google.android.gms:play-services-code-scanner:16.1.0")
    "fdroidImplementation"("com.journeyapps:zxing-android-embedded:4.3.0")
    // Launcher badge counts, same library react-native-push-notification used
    implementation("me.leolin:ShortcutBadger:1.1.22@aar")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
}
