package com.renbrant.voxyl;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(
    name = "BackgroundAudioService",
    permissions = {
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class BackgroundAudioServicePlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            getPermissionState("notifications") != PermissionState.GRANTED
        ) {
            requestPermissionForAlias("notifications", call, "notificationsCallback");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        startService(call);
    }

    private void startService(PluginCall call) {
        Intent intent = new Intent(getContext(), BackgroundAudioService.class);
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), BackgroundAudioService.class);
        getContext().stopService(intent);
        call.resolve(new JSObject());
    }
}
