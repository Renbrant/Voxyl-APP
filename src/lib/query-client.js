import { QueryClient } from '@tanstack/react-query';

// A 429 means the caller is over its limit. Retrying immediately only extends the
// block, so those errors are not retried; other failures keep a single retry.
function shouldRetry(failureCount, error) {
	if (error?.status === 429 || error?.code === 'rate-limited') {
		return false;
	}

	return failureCount < 1;
}

export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: shouldRetry,
		},
	},
});
