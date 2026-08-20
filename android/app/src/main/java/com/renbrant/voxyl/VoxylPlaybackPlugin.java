package com.renbrant.voxyl;

import android.content.ComponentName;
import android.net.Uri;
import android.os.Bundle;

import androidx.core.content.ContextCompat;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionResult;
import androidx.media3.session.SessionToken;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Capacitor controller bridge for Voxyl's process-owned playback service.
 *
 * This plugin never creates or owns an ExoPlayer or MediaSession.
 * Activity/WebView recreation may recreate this controller, while the player,
 * playlist, current item and playback position remain owned by
 * VoxylPlaybackService.
 */
@CapacitorPlugin(name = "VoxylPlayback")
public final class VoxylPlaybackPlugin extends Plugin {

    private static final String EXTRA_QUEUE_ITEM_JSON =
        "voxyl.queueItemJson";

    private ListenableFuture<MediaController> controllerFuture;
    private volatile String connectionError;

    private final Player.Listener playerListener =
        new Player.Listener() {
            @Override
            public void onEvents(Player player, Player.Events events) {
                if (player instanceof MediaController) {
                    notifyListeners(
                        "playbackState",
                        buildState((MediaController) player)
                    );
                }
            }

            @Override
            public void onMediaItemTransition(
                MediaItem mediaItem,
                int reason
            ) {
                if (mediaItem == null) {
                    return;
                }

                notifyListeners(
                    "nativeTrackChanged",
                    buildTrackChangedPayload(mediaItem, reason)
                );
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (playbackState != Player.STATE_ENDED) {
                    return;
                }

                MediaController controller = getReadyController();

                JSObject payload = new JSObject();

                if (controller != null) {
                    payload.put(
                        "index",
                        controller.getCurrentMediaItemIndex()
                    );

                    payload.put(
                        "size",
                        controller.getMediaItemCount()
                    );
                }

                notifyListeners("queueCompleted", payload);
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                JSObject payload = new JSObject();

                payload.put(
                    "message",
                    error.getMessage() != null
                        ? error.getMessage()
                        : "Native playback failed."
                );

                payload.put(
                    "errorCode",
                    error.errorCode
                );

                payload.put(
                    "errorCodeName",
                    error.getErrorCodeName()
                );

                MediaController controller = getReadyController();

                if (
                    controller != null &&
                    controller.getCurrentMediaItem() != null
                ) {
                    payload.put(
                        "index",
                        controller.getCurrentMediaItemIndex()
                    );

                    payload.put(
                        "audioUrl",
                        controller.getCurrentMediaItem().mediaId
                    );
                }

                notifyListeners("playbackError", payload);
            }
        };

    @Override
    public void load() {
        super.load();
        connectController();
    }

    private void connectController() {
        SessionToken sessionToken =
            new SessionToken(
                getContext(),
                new ComponentName(
                    getContext(),
                    VoxylPlaybackService.class
                )
            );

        ListenableFuture<MediaController> future =
            new MediaController.Builder(
                getContext(),
                sessionToken
            ).buildAsync();

        controllerFuture = future;

        future.addListener(
            () -> {
                if (controllerFuture != future) {
                    return;
                }

                try {
                    MediaController controller = future.get();

                    controller.addListener(playerListener);

                    controller.setRepeatMode(
                        Player.REPEAT_MODE_OFF
                    );

                    controller.setShuffleModeEnabled(false);

                    connectionError = null;

                    notifyListeners(
                        "playbackState",
                        buildState(controller)
                    );
                } catch (Exception error) {
                    connectionError =
                        error.getMessage() != null
                            ? error.getMessage()
                            : error.getClass().getSimpleName();
                }
            },
            ContextCompat.getMainExecutor(getContext())
        );
    }

    @PluginMethod
    public void getState(PluginCall call) {
        withController(
            call,
            controller -> call.resolve(buildState(controller))
        );
    }

    /**
     * Replaces the process-owned playlist.
     *
     * If the requested item is already the current item, its current playback
     * position is preserved while the surrounding queue is replaced.
     */
    @PluginMethod
    public void getPlaybackSnapshot(PluginCall call) {
        withController(
            call,
            controller -> {
                JSObject snapshot = new JSObject();

                long positionMs =
                    controller.getCurrentPosition();

                long durationMs =
                    controller.getDuration();

                snapshot.put(
                    "position",
                    Math.max(0L, positionMs) / 1000.0
                );

                snapshot.put(
                    "duration",
                    durationMs == C.TIME_UNSET
                        ? 0.0
                        : Math.max(0L, durationMs) / 1000.0
                );

                call.resolve(snapshot);
            }
        );
    }

    @PluginMethod
    public void setQueue(PluginCall call) {
        replaceQueue(call, "startIndex");
    }

    @PluginMethod
    public void updateQueue(PluginCall call) {
        replaceQueue(call, "currentIndex");
    }

    /**
     * Removes upcoming/previous queue entries without stopping the currently
     * audible item.
     *
     * This preserves compatibility with Voxyl's existing clearNativeQueue()
     * semantics, which are used when automatic advancement is disabled.
     */
    @PluginMethod
    public void clearQueue(PluginCall call) {
        withController(
            call,
            controller -> {
                MediaItem currentItem =
                    controller.getCurrentMediaItem();

                if (currentItem == null) {
                    controller.clearMediaItems();
                    call.resolve(buildState(controller));
                    return;
                }

                long currentPositionMs =
                    Math.max(
                        0L,
                        controller.getCurrentPosition()
                    );

                boolean shouldContinue =
                    controller.getPlayWhenReady();

                controller.setMediaItem(
                    currentItem,
                    currentPositionMs
                );

                controller.prepare();

                if (shouldContinue) {
                    controller.play();
                }

                call.resolve(buildState(controller));
            }
        );
    }

    @PluginMethod
    public void setAutoplay(PluginCall call) {
        Boolean requestedEnabled =
            call.getBoolean("enabled");

        if (requestedEnabled == null) {
            requestedEnabled =
                call.getBoolean("autoplay");
        }

        if (requestedEnabled == null) {
            call.reject(
                "Autoplay enabled state is required.",
                "INVALID_AUTOPLAY_STATE"
            );
            return;
        }

        final boolean enabled =
            requestedEnabled;

        withController(
            call,
            controller ->
                applyAutoplay(
                    controller,
                    enabled,
                    call,
                    resolvedController ->
                        call.resolve(
                            buildState(resolvedController)
                        )
                )
        );
    }
    @PluginMethod
    public void playQueueIndex(PluginCall call) {
        Integer requestedIndex =
            call.getInt("index");

        if (requestedIndex == null) {
            call.reject(
                "Queue index is required.",
                "INVALID_QUEUE_INDEX"
            );
            return;
        }

        withController(
            call,
            controller -> {
                int size = controller.getMediaItemCount();

                if (
                    requestedIndex < 0 ||
                    requestedIndex >= size
                ) {
                    call.reject(
                        "Queue index unavailable: " + requestedIndex,
                        "INVALID_QUEUE_INDEX"
                    );
                    return;
                }

                controller.seekToDefaultPosition(
                    requestedIndex
                );

                controller.prepare();
                controller.play();

                call.resolve(buildState(controller));
            }
        );
    }

    @PluginMethod
    public void playNext(PluginCall call) {
        withController(
            call,
            controller -> {
                if (!controller.hasNextMediaItem()) {
                    JSObject response =
                        buildState(controller);

                    response.put("completed", true);
                    call.resolve(response);
                    return;
                }

                controller.seekToNextMediaItem();
                controller.prepare();
                controller.play();

                call.resolve(buildState(controller));
            }
        );
    }

    @PluginMethod
    public void playPrevious(PluginCall call) {
        withController(
            call,
            controller -> {
                if (!controller.hasPreviousMediaItem()) {
                    call.reject(
                        "Previous queue item unavailable.",
                        "PREVIOUS_QUEUE_ITEM_UNAVAILABLE"
                    );
                    return;
                }

                controller.seekToPreviousMediaItem();
                controller.prepare();
                controller.play();

                call.resolve(buildState(controller));
            }
        );
    }

    @PluginMethod
    public void playMedia(PluginCall call) {
        String audioUrl = call.getString("audioUrl");

        if (!isValidHttpUrl(audioUrl)) {
            call.reject(
                "A valid HTTP(S) audioUrl is required.",
                "INVALID_AUDIO_URL"
            );
            return;
        }

        String title =
            call.getString("title", "");

        String artist =
            call.getString("artist", "Voxyl");

        String artworkUrl =
            call.getString("artworkUrl", "");

        Double requestedResumeAt =
            call.getDouble("resumeAt", 0.0);

        double resumeAt =
            requestedResumeAt != null &&
            Double.isFinite(requestedResumeAt)
                ? Math.max(0.0, requestedResumeAt)
                : 0.0;

        long resumeAtMs =
            Math.round(resumeAt * 1000.0);

        withController(
            call,
            controller -> {
                int existingIndex =
                    findMediaItemIndex(
                        controller,
                        audioUrl
                    );

                if (existingIndex >= 0) {
                    controller.seekTo(
                        existingIndex,
                        resumeAtMs
                    );
                } else {
                    controller.setMediaItem(
                        buildMediaItem(
                            audioUrl,
                            title,
                            artist,
                            artworkUrl
                        ),
                        resumeAtMs
                    );
                }

                controller.prepare();
                controller.play();

                call.resolve(buildState(controller));
            }
        );
    }

    @PluginMethod
    public void pause(PluginCall call) {
        withController(
            call,
            controller -> {
                controller.pause();
                call.resolve(buildState(controller));
            }
        );
    }

    @PluginMethod
    public void resume(PluginCall call) {
        withController(
            call,
            controller -> {
                controller.play();
                call.resolve(buildState(controller));
            }
        );
    }

    @PluginMethod
    public void seek(PluginCall call) {
        Double requestedSeconds =
            call.getDouble("seconds");

        if (
            requestedSeconds == null ||
            !Double.isFinite(requestedSeconds) ||
            requestedSeconds < 0.0
        ) {
            call.reject(
                "A finite non-negative seconds value is required.",
                "INVALID_SEEK_POSITION"
            );
            return;
        }

        long positionMs =
            Math.round(requestedSeconds * 1000.0);

        withController(
            call,
            controller -> {
                controller.seekTo(positionMs);
                call.resolve(buildState(controller));
            }
        );
    }

    @PluginMethod
    public void stop(PluginCall call) {
        withController(
            call,
            controller -> {
                controller.stop();
                controller.clearMediaItems();
                call.resolve(buildState(controller));
            }
        );
    }

    private void replaceQueue(
        PluginCall call,
        String indexProperty
    ) {
        JSArray queue =
            call.getArray("queue");

        if (queue == null) {
            call.reject(
                "Queue is required.",
                "INVALID_QUEUE"
            );
            return;
        }

        final List<MediaItem> mediaItems;

        try {
            mediaItems = buildQueue(queue);
        } catch (IllegalArgumentException error) {
            call.reject(
                error.getMessage(),
                "INVALID_QUEUE"
            );
            return;
        }

        Integer requestedIndexValue =
            call.getInt(indexProperty);

        if (requestedIndexValue == null) {
            requestedIndexValue =
                call.getInt(
                    "startIndex",
                    call.getInt("currentIndex", 0)
                );
        }

        final int requestedIndex =
            requestedIndexValue;

        final boolean autoplay =
            call.getBoolean(
                "autoplay",
                true
            );

        withController(
            call,
            controller ->
                applyAutoplay(
                    controller,
                    autoplay,
                    call,
                    resolvedController -> {
                        if (mediaItems.isEmpty()) {
                            resolvedController.clearMediaItems();

                            call.resolve(
                                buildState(
                                    resolvedController
                                )
                            );

                            return;
                        }

                        int startIndex =
                            Math.max(
                                0,
                                Math.min(
                                    requestedIndex,
                                    mediaItems.size() - 1
                                )
                            );

                        MediaItem requestedItem =
                            mediaItems.get(startIndex);

                        MediaItem currentItem =
                            resolvedController.getCurrentMediaItem();

                        long startPositionMs =
                            C.TIME_UNSET;

                        if (
                            currentItem != null &&
                            currentItem.mediaId.equals(
                                requestedItem.mediaId
                            )
                        ) {
                            startPositionMs =
                                Math.max(
                                    0L,
                                    resolvedController.getCurrentPosition()
                                );
                        }

                        boolean shouldContinue =
                            resolvedController.getPlayWhenReady();

                        resolvedController.setRepeatMode(
                            Player.REPEAT_MODE_OFF
                        );

                        resolvedController.setShuffleModeEnabled(
                            false
                        );

                        resolvedController.setMediaItems(
                            mediaItems,
                            startIndex,
                            startPositionMs
                        );

                        resolvedController.prepare();

                        if (shouldContinue) {
                            resolvedController.play();
                        }

                        call.resolve(
                            buildState(
                                resolvedController
                            )
                        );
                    }
                )
        );
    }
    private List<MediaItem> buildQueue(
        JSArray queue
    ) {
        List<MediaItem> mediaItems =
            new ArrayList<>();

        for (int index = 0; index < queue.length(); index++) {
            JSONObject item =
                queue.optJSONObject(index);

            if (item == null) {
                throw new IllegalArgumentException(
                    "Invalid queue item at index " + index + "."
                );
            }

            String audioUrl =
                firstNonBlank(
                    item.optString("audioUrl", null),
                    item.optString("url", null)
                );

            if (!isValidHttpUrl(audioUrl)) {
                throw new IllegalArgumentException(
                    "Queue item " + index +
                    " has no valid HTTP(S) audio URL."
                );
            }

            String title =
                firstNonBlank(
                    item.optString("title", null),
                    ""
                );

            String artist =
                firstNonBlank(
                    item.optString("podcastTitle", null),
                    item.optString("feedTitle", null),
                    item.optString("showTitle", null),
                    "Voxyl"
                );

            String artworkUrl =
                firstNonBlank(
                    item.optString("artworkUrl", null),
                    item.optString("image", null),
                    item.optString("podcastImage", null),
                    ""
                );

            mediaItems.add(
                buildMediaItem(
                    audioUrl,
                    title,
                    artist,
                    artworkUrl,
                    item.toString()
                )
            );
        }

        return mediaItems;
    }

    private MediaItem buildMediaItem(
        String audioUrl,
        String title,
        String artist,
        String artworkUrl
    ) {
        return buildMediaItem(
            audioUrl,
            title,
            artist,
            artworkUrl,
            null
        );
    }

    private MediaItem buildMediaItem(
        String audioUrl,
        String title,
        String artist,
        String artworkUrl,
        String serializedQueueItem
    ) {
        MediaMetadata.Builder metadataBuilder =
            new MediaMetadata.Builder()
                .setTitle(title != null ? title : "")
                .setArtist(
                    artist != null && !artist.isBlank()
                        ? artist
                        : "Voxyl"
                );

        if (artworkUrl != null && !artworkUrl.isBlank()) {
            metadataBuilder.setArtworkUri(Uri.parse(artworkUrl));
        }

        if (
            serializedQueueItem != null &&
            !serializedQueueItem.isBlank()
        ) {
            Bundle extras = new Bundle();
            extras.putString(
                EXTRA_QUEUE_ITEM_JSON,
                serializedQueueItem
            );
            metadataBuilder.setExtras(extras);
        }

        return new MediaItem.Builder()
            .setMediaId(audioUrl)
            .setUri(audioUrl)
            .setMediaMetadata(metadataBuilder.build())
            .build();
    }
    private JSObject buildState(
        MediaController controller
    ) {
        JSObject state = new JSObject();

        state.put("connected", true);

        Bundle sessionExtras =
            controller.getSessionExtras();

        state.put(
            "autoplay",
            sessionExtras.getBoolean(
                VoxylPlaybackService.EXTRA_AUTOPLAY_ENABLED,
                true
            )
        );

        state.put(
            "hasMedia",
            controller.getCurrentMediaItem() != null
        );

        state.put(
            "isPlaying",
            controller.isPlaying()
        );

        state.put(
            "playWhenReady",
            controller.getPlayWhenReady()
        );

        state.put(
            "playbackState",
            controller.getPlaybackState()
        );

        state.put(
            "index",
            controller.getCurrentMediaItemIndex()
        );

        state.put(
            "queueSize",
            controller.getMediaItemCount()
        );

        state.put(
            "hasNext",
            controller.hasNextMediaItem()
        );

        state.put(
            "hasPrevious",
            controller.hasPreviousMediaItem()
        );

        state.put(
            "queue",
            buildQueuePayload(controller)
        );
        long positionMs =
            controller.getCurrentPosition();

        long durationMs =
            controller.getDuration();

        state.put(
            "position",
            Math.max(0L, positionMs) / 1000.0
        );

        state.put(
            "duration",
            durationMs == C.TIME_UNSET
                ? 0.0
                : Math.max(0L, durationMs) / 1000.0
        );

        MediaItem currentItem =
            controller.getCurrentMediaItem();

        if (currentItem != null) {
            state.put(
                "currentTrack",
                buildRestoredQueueItem(
                    currentItem,
                    controller.getCurrentMediaItemIndex()
                )
            );
            state.put(
                "mediaId",
                currentItem.mediaId
            );

            state.put(
                "audioUrl",
                currentItem.mediaId
            );

            addMetadataToPayload(
                state,
                currentItem.mediaMetadata
            );
        }

        return state;
    }

    private JSObject buildTrackChangedPayload(
        MediaItem mediaItem,
        int reason
    ) {
        JSObject payload = new JSObject();

        payload.put(
            "mediaId",
            mediaItem.mediaId
        );

        payload.put(
            "audioUrl",
            mediaItem.mediaId
        );

        payload.put(
            "url",
            mediaItem.mediaId
        );

        payload.put(
            "reason",
            reason
        );

        payload.put(
            "automatic",
            reason ==
                Player.MEDIA_ITEM_TRANSITION_REASON_AUTO
        );

        MediaController controller =
            getReadyController();

        if (controller != null) {
            payload.put(
                "index",
                controller.getCurrentMediaItemIndex()
            );

            payload.put(
                "queueSize",
                controller.getMediaItemCount()
            );

            payload.put(
                "isPlaying",
                controller.isPlaying()
            );
        }

        addMetadataToPayload(
            payload,
            mediaItem.mediaMetadata
        );

        return payload;
    }

    private JSArray buildQueuePayload(
        MediaController controller
    ) {
        JSArray queue = new JSArray();

        for (
            int index = 0;
            index < controller.getMediaItemCount();
            index++
        ) {
            queue.put(
                buildRestoredQueueItem(
                    controller.getMediaItemAt(index),
                    index
                )
            );
        }

        return queue;
    }

    private JSObject buildRestoredQueueItem(
        MediaItem mediaItem,
        int index
    ) {
        JSONObject source = null;
        Bundle extras = mediaItem.mediaMetadata.extras;

        if (extras != null) {
            String serialized =
                extras.getString(EXTRA_QUEUE_ITEM_JSON);

            if (serialized != null && !serialized.isBlank()) {
                try {
                    source = new JSONObject(serialized);
                } catch (Exception ignored) {
                    source = null;
                }
            }
        }

        String audioUrl =
            firstNonBlank(
                jsonString(source, "audioUrl"),
                jsonString(source, "url"),
                mediaItem.mediaId
            );

        String id =
            firstNonBlank(
                jsonString(source, "id"),
                jsonString(source, "episodeId"),
                audioUrl
            );

        String episodeId =
            firstNonBlank(
                jsonString(source, "episodeId"),
                id
            );

        String title =
            firstNonBlank(
                jsonString(source, "title"),
                mediaItem.mediaMetadata.title != null
                    ? mediaItem.mediaMetadata.title.toString()
                    : ""
            );

        String podcastTitle =
            firstNonBlank(
                jsonString(source, "podcastTitle"),
                jsonString(source, "feedTitle"),
                jsonString(source, "showTitle"),
                mediaItem.mediaMetadata.artist != null
                    ? mediaItem.mediaMetadata.artist.toString()
                    : "Voxyl"
            );

        String feedTitle =
            firstNonBlank(
                jsonString(source, "feedTitle"),
                podcastTitle
            );

        String artworkUrl =
            firstNonBlank(
                jsonString(source, "artworkUrl"),
                jsonString(source, "image"),
                jsonString(source, "podcastImage"),
                mediaItem.mediaMetadata.artworkUri != null
                    ? mediaItem.mediaMetadata.artworkUri.toString()
                    : ""
            );

        JSObject payload = new JSObject();

        payload.put("id", id);
        payload.put("episodeId", episodeId);
        payload.put("title", title);
        payload.put("podcastTitle", podcastTitle);
        payload.put("feedTitle", feedTitle);
        payload.put(
            "showTitle",
            firstNonBlank(
                jsonString(source, "showTitle"),
                podcastTitle
            )
        );
        payload.put("audioUrl", audioUrl);
        payload.put("url", audioUrl);
        payload.put("artworkUrl", artworkUrl);
        payload.put("image", artworkUrl);
        payload.put(
            "podcastImage",
            firstNonBlank(
                jsonString(source, "podcastImage"),
                artworkUrl
            )
        );
        payload.put(
            "playlistId",
            firstNonBlank(
                jsonString(source, "playlistId"),
                ""
            )
        );
        payload.put(
            "feedUrl",
            firstNonBlank(
                jsonString(source, "feedUrl"),
                jsonString(source, "feed_url"),
                ""
            )
        );
        payload.put(
            "skip_start_seconds",
            jsonNonNegativeDouble(
                source,
                "skip_start_seconds"
            )
        );
        payload.put(
            "skip_end_seconds",
            jsonNonNegativeDouble(
                source,
                "skip_end_seconds"
            )
        );
        payload.put("index", index);

        return payload;
    }

    private double jsonNonNegativeDouble(
        JSONObject source,
        String key
    ) {
        if (source == null) {
            return 0.0;
        }

        double value = source.optDouble(key, 0.0);

        if (!Double.isFinite(value)) {
            return 0.0;
        }

        return Math.max(0.0, value);
    }

    private String jsonString(
        JSONObject source,
        String key
    ) {
        if (source == null) {
            return null;
        }

        String value = source.optString(key, null);

        if (
            value == null ||
            value.isBlank() ||
            "null".equals(value)
        ) {
            return null;
        }

        return value;
    }
    private void addMetadataToPayload(
        JSObject payload,
        MediaMetadata metadata
    ) {
        if (metadata.title != null) {
            payload.put(
                "title",
                metadata.title.toString()
            );
        }

        if (metadata.artist != null) {
            String artist =
                metadata.artist.toString();

            payload.put("artist", artist);
            payload.put("podcastTitle", artist);
            payload.put("feedTitle", artist);
        }

        if (metadata.artworkUri != null) {
            String artwork =
                metadata.artworkUri.toString();

            payload.put("artworkUrl", artwork);
            payload.put("image", artwork);
        }
    }

    private int findMediaItemIndex(
        MediaController controller,
        String mediaId
    ) {
        for (
            int index = 0;
            index < controller.getMediaItemCount();
            index++
        ) {
            MediaItem item =
                controller.getMediaItemAt(index);

            if (mediaId.equals(item.mediaId)) {
                return index;
            }
        }

        return -1;
    }

    private String firstNonBlank(
        String... values
    ) {
        for (String value : values) {
            if (
                value != null &&
                !value.isBlank() &&
                !"null".equals(value)
            ) {
                return value;
            }
        }

        return "";
    }

    private boolean isValidHttpUrl(
        String value
    ) {
        return
            value != null &&
            !value.isBlank() &&
            (
                value.startsWith("https://") ||
                value.startsWith("http://")
            );
    }

    private MediaController getReadyController() {
        ListenableFuture<MediaController> future =
            controllerFuture;

        if (
            future == null ||
            !future.isDone() ||
            future.isCancelled()
        ) {
            return null;
        }

        try {
            return future.get();
        } catch (Exception ignored) {
            return null;
        }
    }

    private void applyAutoplay(
        MediaController controller,
        boolean enabled,
        PluginCall call,
        ControllerAction continuation
    ) {
        Bundle args = new Bundle();

        args.putBoolean(
            VoxylPlaybackService.ARG_AUTOPLAY_ENABLED,
            enabled
        );

        SessionCommand command =
            new SessionCommand(
                VoxylPlaybackService.COMMAND_SET_AUTOPLAY,
                Bundle.EMPTY
            );

        ListenableFuture<SessionResult> resultFuture =
            controller.sendCustomCommand(
                command,
                args
            );

        resultFuture.addListener(
            () -> {
                try {
                    SessionResult result =
                        resultFuture.get();

                    if (
                        result.resultCode !=
                        SessionResult.RESULT_SUCCESS
                    ) {
                        call.reject(
                            "Playback service rejected autoplay state.",
                            "AUTOPLAY_COMMAND_FAILED"
                        );
                        return;
                    }

                    continuation.run(controller);
                } catch (Exception error) {
                    String message =
                        error.getMessage() != null
                            ? error.getMessage()
                            : "Unable to update autoplay state.";

                    call.reject(
                        message,
                        "AUTOPLAY_COMMAND_ERROR",
                        error
                    );
                }
            },
            ContextCompat.getMainExecutor(
                getContext()
            )
        );
    }
    private void withController(
        PluginCall call,
        ControllerAction action
    ) {
        ListenableFuture<MediaController> future =
            controllerFuture;

        if (future == null) {
            call.reject(
                connectionError != null
                    ? connectionError
                    : "Playback controller is unavailable.",
                "PLAYBACK_CONTROLLER_UNAVAILABLE"
            );
            return;
        }

        future.addListener(
            () -> {
                if (controllerFuture != future) {
                    call.reject(
                        "Playback controller was released.",
                        "PLAYBACK_CONTROLLER_RELEASED"
                    );
                    return;
                }

                try {
                    MediaController controller =
                        future.get();

                    action.run(controller);
                } catch (Exception error) {
                    String message =
                        error.getMessage() != null
                            ? error.getMessage()
                            : "Unable to communicate with playback service.";

                    call.reject(
                        message,
                        "PLAYBACK_CONTROLLER_ERROR",
                        error
                    );
                }
            },
            ContextCompat.getMainExecutor(getContext())
        );
    }

    @Override
    protected void handleOnDestroy() {
        ListenableFuture<MediaController> future =
            controllerFuture;

        controllerFuture = null;

        if (future != null) {
            if (future.isDone()) {
                try {
                    MediaController controller =
                        future.get();

                    controller.removeListener(
                        playerListener
                    );
                } catch (Exception ignored) {
                    // Connection may already have failed or been released.
                }
            }

            MediaController.releaseFuture(future);
        }

        super.handleOnDestroy();
    }

    @FunctionalInterface
    private interface ControllerAction {
        void run(
            MediaController controller
        ) throws Exception;
    }
}
