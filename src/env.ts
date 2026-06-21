import type { ReleaseStore } from './storage';

export interface Env {
	RELEASE_STORE: DurableObjectNamespace<ReleaseStore>;

	// vars
	GITHUB_API_BASE_URL: string;
	TELEGRAM_API_BASE_URL: string;
	RELEASEBOT_WORKFLOW_FILE: string;
	TELEGRAM_ALLOWED_USER_IDS: string;
	TELEGRAM_CHAT_ID: string;

	// secrets
	TELEGRAM_BOT_TOKEN: string;
	TELEGRAM_BOT_INFO: string;
	TELEGRAM_WEBHOOK_SECRET_TOKEN: string;
	GITHUB_TOKEN: string;
	RELEASEBOT_SHARED_SECRET: string;
}
