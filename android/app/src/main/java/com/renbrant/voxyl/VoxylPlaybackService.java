package com.renbrant.voxyl;

import android.os.Bundle;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionCommands;
import androidx.media3.session.SessionResult;

import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

/**
 * Process-level playback authority for Voxyl.
 *
 * Issue #81 established that Activity/WebView recreation must never create
 * another independent player. This service owns the ExoPlayer, MediaSession,
 * playlist and playback policy.
 */
@UnstableApi
public final class VoxylPlaybackService extends MediaSessionService {

    public static final String COMMAND_SET_AUTOPLAY =
        "com.renbrant.voxyl.SET_AUTOPLAY";

    public static final String ARG_AUTOPLAY_ENABLED =
        "enabled";

    public static final String EXTRA_AUTOPLAY_ENABLED =
        "voxyl.autoplayEnabled";

    private ExoPlayer player;
    private MediaSession mediaSession;
    private boolean autoplayEnabled = true;

    @Override
    public void onCreate() {
        super.onCreate();

        AudioAttributes audioAttributes =
            new AudioAttributes.Builder()
                .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                .setUsage(C.USAGE_MEDIA)
                .build();

        player =
            new ExoPlayer.Builder(this)
                .setPauseAtEndOfMediaItems(false)
                .build();

        player.setAudioAttributes(
            audioAttributes,
            true
        );

        mediaSession =
            new MediaSession.Builder(this, player)
                .setSessionExtras(buildSessionExtras())
                .setCallback(new PlaybackSessionCallback())
                .build();
    }

    @Override
    public MediaSession onGetSession(
        MediaSession.ControllerInfo controllerInfo
    ) {
        return mediaSession;
    }

    private Bundle buildSessionExtras() {
        Bundle extras = new Bundle();

        extras.putBoolean(
            EXTRA_AUTOPLAY_ENABLED,
            autoplayEnabled
        );

        return extras;
    }

    private void setAutoplayEnabled(
        MediaSession session,
        boolean enabled
    ) {
        autoplayEnabled = enabled;

        /*
         * Media3 keeps the playlist intact. When autoplay is disabled the
         * process-owned ExoPlayer pauses at the end of each media item instead
         * of automatically continuing through the playlist.
         */
        player.setPauseAtEndOfMediaItems(
            !enabled
        );

        session.setSessionExtras(
            buildSessionExtras()
        );
    }

    private final class PlaybackSessionCallback
        implements MediaSession.Callback {

        @Override
        public MediaSession.ConnectionResult onConnect(
            MediaSession session,
            MediaSession.ControllerInfo controller
        ) {
            MediaSession.ConnectionResult baseResult =
                MediaSession.Callback.super.onConnect(
                    session,
                    controller
                );

            if (!baseResult.isAccepted) {
                return baseResult;
            }

            SessionCommands sessionCommands =
                baseResult
                    .availableSessionCommands
                    .buildUpon()
                    .add(
                        new SessionCommand(
                            COMMAND_SET_AUTOPLAY,
                            Bundle.EMPTY
                        )
                    )
                    .build();

            return MediaSession.ConnectionResult.accept(
                sessionCommands,
                baseResult.availablePlayerCommands
            );
        }

        @Override
        public ListenableFuture<SessionResult> onCustomCommand(
            MediaSession session,
            MediaSession.ControllerInfo controller,
            SessionCommand customCommand,
            Bundle args
        ) {
            if (
                !COMMAND_SET_AUTOPLAY.equals(
                    customCommand.customAction
                )
            ) {
                return MediaSession.Callback.super.onCustomCommand(
                    session,
                    controller,
                    customCommand,
                    args
                );
            }

            boolean enabled =
                args.getBoolean(
                    ARG_AUTOPLAY_ENABLED,
                    true
                );

            setAutoplayEnabled(
                session,
                enabled
            );

            return Futures.immediateFuture(
                new SessionResult(
                    SessionResult.RESULT_SUCCESS,
                    buildSessionExtras()
                )
            );
        }
    }

    @Override
    public void onDestroy() {
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }

        if (player != null) {
            player.release();
            player = null;
        }

        super.onDestroy();
    }
}
