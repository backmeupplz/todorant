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
        versionCode = 5_000_000
        versionName = "2.0.0"
    }
    buildFeatures { compose = true; buildConfig = true }
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
    // socket.io v2 server speaks Engine.IO 3, which only the 1.x Java client supports
    implementation("io.socket:socket.io-client:1.0.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.credentials:credentials:1.6.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.2.1")
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
}
