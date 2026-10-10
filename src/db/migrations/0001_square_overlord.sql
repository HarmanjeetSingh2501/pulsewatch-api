DROP INDEX "pings_url_checked_idx";--> statement-breakpoint
CREATE INDEX "pings_url_checked_idx" ON "pings" USING btree ("url_id","checked_at" DESC NULLS LAST);