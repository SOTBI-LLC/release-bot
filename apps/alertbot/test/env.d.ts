export {};
declare global {
	namespace Cloudflare {
		interface Env {
			TELEGRAM_BOT_TOKEN: string;
			GRAFANA_WEBHOOK_SECRET: string;
			DELIVERY_ADMIN_SECRET: string;
		}
	}
}
