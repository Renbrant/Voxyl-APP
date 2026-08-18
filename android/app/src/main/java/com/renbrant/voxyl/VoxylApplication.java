package com.renbrant.voxyl;

import android.app.Application;

import com.clerk.api.Clerk;

/**
 * Android application bootstrap for Voxyl.
 *
 * Clerk is initialized once at process startup so the native SDK can restore
 * and manage the Android authentication session independently from Clerk React.
 */
public class VoxylApplication extends Application {

    @Override
    public void onCreate() {
        super.onCreate();

        String publishableKey = getString(R.string.clerk_publishable_key).trim();

        if (!publishableKey.startsWith("pk_")) {
            throw new IllegalStateException(
                "Clerk publishable key is missing or invalid."
            );
        }

        Clerk.INSTANCE.initialize(this, publishableKey);
    }
}
