package com.renbrant.voxyl;

import com.clerk.api.Clerk;
import com.clerk.api.auth.HostedAuthMode;
import com.clerk.api.network.model.error.ClerkErrorResponse;
import com.clerk.api.network.serialization.ClerkResult;
import com.clerk.api.session.GetTokenOptions;
import com.clerk.api.session.Session;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import kotlin.ResultKt;
import kotlin.Unit;
import kotlin.coroutines.Continuation;
import kotlin.coroutines.CoroutineContext;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlin.coroutines.intrinsics.IntrinsicsKt;

/**
 * Capacitor bridge between the Voxyl React application and Clerk Android.
 *
 * Clerk Android owns the native authentication session.
 * Android web code must obtain session state and JWTs through this bridge
 * instead of using Clerk React as the native session owner.
 */
@CapacitorPlugin(name = "ClerkNative")
public class ClerkNativePlugin extends Plugin {

    /**
     * Returns Clerk initialization and authentication state.
     */
    @PluginMethod
    public void getState(PluginCall call) {
        boolean initialized =
            Boolean.TRUE.equals(Clerk.INSTANCE.isInitialized().getValue());

        boolean signedIn =
            initialized && Clerk.INSTANCE.isSignedIn();

        JSObject response = new JSObject();
        response.put("initialized", initialized);
        response.put("signedIn", signedIn);

        Session activeSession =
            signedIn ? Clerk.INSTANCE.getActiveSession() : null;

        if (activeSession != null) {
            response.put("sessionId", activeSession.getId());
        }

        call.resolve(response);
    }

    /**
     * Opens Clerk Account Portal and activates the resulting native session.
     *
     * The callback is:
     * clerk://com.renbrant.voxyl.callback
     *
     * No JWT is transported through the callback URL.
     */
    @PluginMethod
    public void signIn(PluginCall call) {
        if (!isClerkInitialized()) {
            call.reject(
                "Clerk Android is still initializing.",
                "CLERK_NOT_READY"
            );
            return;
        }

        if (Clerk.INSTANCE.isSignedIn()) {
            resolveCurrentState(call);
            return;
        }

        String redirectUrl =
            "clerk://" + getContext().getPackageName() + ".callback";

        Continuation<ClerkResult<Session, ClerkErrorResponse>> continuation =
            new Continuation<ClerkResult<Session, ClerkErrorResponse>>() {

                @Override
                public CoroutineContext getContext() {
                    return EmptyCoroutineContext.INSTANCE;
                }

                @Override
                public void resumeWith(Object outcome) {
                    try {
                        ResultKt.throwOnFailure(outcome);

                        @SuppressWarnings("unchecked")
                        ClerkResult<Session, ClerkErrorResponse> result =
                            (ClerkResult<Session, ClerkErrorResponse>) outcome;

                        handleHostedAuthResult(call, result);
                    } catch (Throwable error) {
                        rejectNativeError(
                            call,
                            "CLERK_HOSTED_AUTH_EXCEPTION",
                            error
                        );
                    }
                }
            };

        try {
            Object immediateResult =
                Clerk.INSTANCE
                    .getAuth()
                    .startHostedAuth(
                        HostedAuthMode.SIGN_IN,
                        redirectUrl,
                        continuation
                    );

            if (immediateResult != IntrinsicsKt.getCOROUTINE_SUSPENDED()) {
                @SuppressWarnings("unchecked")
                ClerkResult<Session, ClerkErrorResponse> result =
                    (ClerkResult<Session, ClerkErrorResponse>) immediateResult;

                handleHostedAuthResult(call, result);
            }
        } catch (Throwable error) {
            rejectNativeError(
                call,
                "CLERK_HOSTED_AUTH_EXCEPTION",
                error
            );
        }
    }

    /**
     * Gets the Clerk JWT for the active native session.
     *
     * The token is returned only to the Capacitor web layer and must never
     * be written to logs.
     */
    @PluginMethod
    public void getToken(PluginCall call) {
        if (!isClerkInitialized()) {
            call.reject(
                "Clerk Android is still initializing.",
                "CLERK_NOT_READY"
            );
            return;
        }

        if (!Clerk.INSTANCE.isSignedIn()) {
            JSObject response = new JSObject();
            response.put("signedIn", false);
            call.resolve(response);
            return;
        }

        Continuation<ClerkResult<String, ClerkErrorResponse>> continuation =
            new Continuation<ClerkResult<String, ClerkErrorResponse>>() {

                @Override
                public CoroutineContext getContext() {
                    return EmptyCoroutineContext.INSTANCE;
                }

                @Override
                public void resumeWith(Object outcome) {
                    try {
                        ResultKt.throwOnFailure(outcome);

                        @SuppressWarnings("unchecked")
                        ClerkResult<String, ClerkErrorResponse> result =
                            (ClerkResult<String, ClerkErrorResponse>) outcome;

                        handleTokenResult(call, result);
                    } catch (Throwable error) {
                        rejectNativeError(
                            call,
                            "CLERK_TOKEN_EXCEPTION",
                            error
                        );
                    }
                }
            };

        try {
            Object immediateResult =
                Clerk.INSTANCE
                    .getAuth()
                    .getToken(
                        new GetTokenOptions(),
                        continuation
                    );

            if (immediateResult != IntrinsicsKt.getCOROUTINE_SUSPENDED()) {
                @SuppressWarnings("unchecked")
                ClerkResult<String, ClerkErrorResponse> result =
                    (ClerkResult<String, ClerkErrorResponse>) immediateResult;

                handleTokenResult(call, result);
            }
        } catch (Throwable error) {
            rejectNativeError(
                call,
                "CLERK_TOKEN_EXCEPTION",
                error
            );
        }
    }

    /**
     * Signs out all Clerk sessions on this native client.
     *
     * Clerk clears local credentials even if the server-side operation fails.
     */
    @PluginMethod
    public void signOut(PluginCall call) {
        if (!isClerkInitialized()) {
            call.reject(
                "Clerk Android is still initializing.",
                "CLERK_NOT_READY"
            );
            return;
        }

        if (!Clerk.INSTANCE.isSignedIn()) {
            JSObject response = new JSObject();
            response.put("signedIn", false);
            response.put("serverSignOutSucceeded", true);
            call.resolve(response);
            return;
        }

        Continuation<ClerkResult<Unit, ClerkErrorResponse>> continuation =
            new Continuation<ClerkResult<Unit, ClerkErrorResponse>>() {

                @Override
                public CoroutineContext getContext() {
                    return EmptyCoroutineContext.INSTANCE;
                }

                @Override
                public void resumeWith(Object outcome) {
                    try {
                        ResultKt.throwOnFailure(outcome);

                        @SuppressWarnings("unchecked")
                        ClerkResult<Unit, ClerkErrorResponse> result =
                            (ClerkResult<Unit, ClerkErrorResponse>) outcome;

                        handleSignOutResult(call, result);
                    } catch (Throwable error) {
                        rejectNativeError(
                            call,
                            "CLERK_SIGN_OUT_EXCEPTION",
                            error
                        );
                    }
                }
            };

        try {
            Object immediateResult =
                Clerk.INSTANCE
                    .getAuth()
                    .signOut(
                        null,
                        continuation
                    );

            if (immediateResult != IntrinsicsKt.getCOROUTINE_SUSPENDED()) {
                @SuppressWarnings("unchecked")
                ClerkResult<Unit, ClerkErrorResponse> result =
                    (ClerkResult<Unit, ClerkErrorResponse>) immediateResult;

                handleSignOutResult(call, result);
            }
        } catch (Throwable error) {
            rejectNativeError(
                call,
                "CLERK_SIGN_OUT_EXCEPTION",
                error
            );
        }
    }

    private boolean isClerkInitialized() {
        return Boolean.TRUE.equals(
            Clerk.INSTANCE.isInitialized().getValue()
        );
    }

    private void resolveCurrentState(PluginCall call) {
        JSObject response = new JSObject();
        response.put("signedIn", Clerk.INSTANCE.isSignedIn());

        Session activeSession = Clerk.INSTANCE.getActiveSession();

        if (activeSession != null) {
            response.put("sessionId", activeSession.getId());
        }

        call.resolve(response);
    }

    private void handleHostedAuthResult(
        PluginCall call,
        ClerkResult<Session, ClerkErrorResponse> result
    ) {
        if (result instanceof ClerkResult.Success<?>) {
            resolveCurrentState(call);
            return;
        }

        if (result instanceof ClerkResult.Failure<?>) {
            ClerkResult.Failure<?> failure =
                (ClerkResult.Failure<?>) result;

            call.reject(
                failureMessage(
                    failure,
                    "Clerk hosted authentication failed."
                ),
                "CLERK_HOSTED_AUTH_FAILED"
            );
            return;
        }

        call.reject(
            "Clerk hosted authentication returned an unknown result.",
            "CLERK_UNKNOWN_RESULT"
        );
    }

    private void handleTokenResult(
        PluginCall call,
        ClerkResult<String, ClerkErrorResponse> result
    ) {
        if (result instanceof ClerkResult.Success<?>) {
            ClerkResult.Success<?> success =
                (ClerkResult.Success<?>) result;

            Object value = success.getValue();

            if (!(value instanceof String) || ((String) value).isBlank()) {
                call.reject(
                    "Clerk returned an empty session token.",
                    "CLERK_EMPTY_TOKEN"
                );
                return;
            }

            JSObject response = new JSObject();
            response.put("signedIn", true);
            response.put("token", (String) value);

            call.resolve(response);
            return;
        }

        if (result instanceof ClerkResult.Failure<?>) {
            ClerkResult.Failure<?> failure =
                (ClerkResult.Failure<?>) result;

            call.reject(
                failureMessage(
                    failure,
                    "Unable to obtain Clerk session token."
                ),
                "CLERK_TOKEN_FAILED"
            );
            return;
        }

        call.reject(
            "Clerk token request returned an unknown result.",
            "CLERK_UNKNOWN_RESULT"
        );
    }

    private void handleSignOutResult(
        PluginCall call,
        ClerkResult<Unit, ClerkErrorResponse> result
    ) {
        JSObject response = new JSObject();
        response.put("signedIn", Clerk.INSTANCE.isSignedIn());

        if (result instanceof ClerkResult.Success<?>) {
            response.put("serverSignOutSucceeded", true);
            call.resolve(response);
            return;
        }

        if (result instanceof ClerkResult.Failure<?>) {
            ClerkResult.Failure<?> failure =
                (ClerkResult.Failure<?>) result;

            /*
             * Clerk's all-session sign-out clears local credentials even when
             * the server operation fails. Return the resulting local state
             * instead of pretending the user is still signed in locally.
             */
            response.put("serverSignOutSucceeded", false);
            response.put(
                "warning",
                failureMessage(
                    failure,
                    "Server-side Clerk sign-out failed."
                )
            );

            call.resolve(response);
            return;
        }

        call.reject(
            "Clerk sign-out returned an unknown result.",
            "CLERK_UNKNOWN_RESULT"
        );
    }

    private String failureMessage(
        ClerkResult.Failure<?> failure,
        String fallback
    ) {
        Throwable throwable = failure.getThrowable();

        if (
            throwable != null &&
            throwable.getMessage() != null &&
            !throwable.getMessage().isBlank()
        ) {
            return throwable.getMessage();
        }

        return fallback;
    }

    private void rejectNativeError(
        PluginCall call,
        String code,
        Throwable error
    ) {
        String message =
            error != null &&
            error.getMessage() != null &&
            !error.getMessage().isBlank()
                ? error.getMessage()
                : "Unexpected Clerk native error.";

        if (error instanceof Exception) {
            call.reject(
                message,
                code,
                (Exception) error
            );
        } else {
            call.reject(message, code);
        }
    }
}
