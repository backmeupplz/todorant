-dontwarn okhttp3.**
-dontwarn okio.**

# ML Kit creates its component registrars by reflection from manifest meta-data; R8 full mode drops their
# no-arg constructors, and then "Login with QR" crashes (SharedPrefManager is null)
-keep class * implements com.google.firebase.components.ComponentRegistrar { <init>(); }
