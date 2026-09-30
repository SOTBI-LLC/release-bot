// Generated bindings, with string vars widened for local/deployment configuration.
export type Env = {
	[Key in keyof Cloudflare.Env]: Cloudflare.Env[Key] extends string ? string : Cloudflare.Env[Key];
} & {
	TELEGRAM_BOT_TOKEN: string;
	GRAFANA_WEBHOOK_SECRET: string;
	DELIVERY_ADMIN_SECRET: string;
};
