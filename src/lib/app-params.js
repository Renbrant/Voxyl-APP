const isNode = typeof window === 'undefined';
const windowObj = isNode ? { localStorage: new Map() } : window;
const storage = windowObj.localStorage;

const DEFAULT_BASE44_APP_ID = '69e2ae13aa773b21002b1fe4';
const DEFAULT_BASE44_API_URL = 'https://base44.app';
const DEFAULT_BASE44_APP_BASE_URL = 'https://voxyl-app.base44.app';
const DEFAULT_BASE44_FUNCTIONS_VERSION = 'prod';

const toSnakeCase = (str) => {
	return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

const cleanValue = (value) => {
	if (typeof value !== 'string') return value;
	const trimmed = value.trim();
	return trimmed && trimmed !== 'null' && trimmed !== 'undefined' ? trimmed : null;
}

const cleanBaseUrl = (value, fallback) => {
	const cleaned = cleanValue(value) || fallback;
	return cleaned.replace(/\/+$/, '');
}

const getAppParamValue = (paramName, { defaultValue = undefined, removeFromUrl = false } = {}) => {
	if (isNode) {
		return defaultValue;
	}
	const storageKey = `base44_${toSnakeCase(paramName)}`;
	const urlParams = new URLSearchParams(window.location.search);
	const searchParam = urlParams.get(paramName);
	if (removeFromUrl) {
		urlParams.delete(paramName);
		const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ""
			}${window.location.hash}`;
		window.history.replaceState({}, document.title, newUrl);
	}
	if (searchParam) {
		storage.setItem(storageKey, searchParam);
		return searchParam;
	}
	if (defaultValue) {
		storage.setItem(storageKey, defaultValue);
		return defaultValue;
	}
	const storedValue = storage.getItem(storageKey);
	if (storedValue) {
		return storedValue;
	}
	return null;
}

const getAppParams = () => {
	if (getAppParamValue("clear_access_token") === 'true') {
		storage.removeItem('base44_access_token');
		storage.removeItem('token');
	}
	const appId = cleanValue(getAppParamValue("app_id", {
		defaultValue: import.meta.env.VITE_BASE44_APP_ID || DEFAULT_BASE44_APP_ID
	}));
	const serverUrl = cleanBaseUrl(
		getAppParamValue("server_url", {
			defaultValue: import.meta.env.VITE_BASE44_API_URL || DEFAULT_BASE44_API_URL
		}),
		DEFAULT_BASE44_API_URL
	);
	const appBaseUrl = cleanBaseUrl(
		getAppParamValue("app_base_url", {
			defaultValue: import.meta.env.VITE_BASE44_APP_BASE_URL || DEFAULT_BASE44_APP_BASE_URL
		}),
		DEFAULT_BASE44_APP_BASE_URL
	);

	return {
		appId,
		token: getAppParamValue("access_token", { removeFromUrl: true }),
		fromUrl: getAppParamValue("from_url", { defaultValue: window.location.href }),
		functionsVersion: cleanValue(getAppParamValue("functions_version", {
			defaultValue: import.meta.env.VITE_BASE44_FUNCTIONS_VERSION || DEFAULT_BASE44_FUNCTIONS_VERSION
		})),
		appBaseUrl,
		serverUrl,
	}
}


export const appParams = {
	...getAppParams()
}

export const base44ConfigError = !appParams.appId
	? 'VITE_BASE44_APP_ID is missing.'
	: null;

export const isBase44Configured = !base44ConfigError;
