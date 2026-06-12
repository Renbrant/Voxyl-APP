# Android OAuth / Login - Capacitor

## Native callback

The Android build opens Base44 login in the Capacitor Browser and uses this
verified App Link as the OAuth callback:

```txt
https://voxyl.renbrant.com/auth/callback
```

The custom-scheme fallback remains available:

```txt
com.renbrant.voxyl://auth/callback
```

The callback handler accepts `access_token` and `access_tc`, stores the token
for Base44 authentication, closes the Capacitor Browser, and returns the user
to the route that initiated login.

## Android App Link verification

The Digital Asset Links file must remain publicly available at:

```txt
https://voxyl.renbrant.com/.well-known/assetlinks.json
```

It must contain the package name `com.renbrant.voxyl` and the SHA-256
fingerprint of the certificate used to sign the installed APK.
