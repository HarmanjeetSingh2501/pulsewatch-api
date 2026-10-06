CREATE TABLE "incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"url_id" integer NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"status" varchar(20) NOT NULL,
	"error_type" varchar(50),
	"ai_summary" text,
	"prompt_version" integer,
	"ai_generated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ping_rollups" (
	"url_id" integer NOT NULL,
	"hour_bucket" timestamp NOT NULL,
	"avg_response_time" integer,
	"uptime_percent" numeric(5, 2),
	"ping_count" integer
);
--> statement-breakpoint
CREATE TABLE "pings" (
	"id" serial PRIMARY KEY NOT NULL,
	"url_id" integer NOT NULL,
	"status_code" integer,
	"response_time_ms" integer,
	"is_up" boolean NOT NULL,
	"error_message" text,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "urls" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"url" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"check_interval_seconds" integer DEFAULT 30 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"next_check_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_url_id_urls_id_fk" FOREIGN KEY ("url_id") REFERENCES "public"."urls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ping_rollups" ADD CONSTRAINT "ping_rollups_url_id_urls_id_fk" FOREIGN KEY ("url_id") REFERENCES "public"."urls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pings" ADD CONSTRAINT "pings_url_id_urls_id_fk" FOREIGN KEY ("url_id") REFERENCES "public"."urls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "urls" ADD CONSTRAINT "urls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incidents_url_status_idx" ON "incidents" USING btree ("url_id","status");--> statement-breakpoint
CREATE INDEX "ping_rollups_pk" ON "ping_rollups" USING btree ("url_id","hour_bucket");--> statement-breakpoint
CREATE INDEX "pings_url_checked_idx" ON "pings" USING btree ("url_id","checked_at");--> statement-breakpoint
CREATE INDEX "urls_next_check_idx" ON "urls" USING btree ("next_check_at");--> statement-breakpoint
CREATE INDEX "urls_user_idx" ON "urls" USING btree ("user_id");