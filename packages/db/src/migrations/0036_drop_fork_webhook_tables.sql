DO $$
DECLARE
  table_name text;
  has_rows boolean;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['webhook_delivery', 'webhook_event', 'webhook_subscription', 'webhook_endpoint'] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', table_name) INTO has_rows;
      IF has_rows THEN
        RAISE EXCEPTION 'Refusing to drop %: it holds rows. Migrate or delete them before applying the upstream webhooks migration.', table_name;
      END IF;
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
DROP TABLE IF EXISTS "webhook_delivery" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "webhook_subscription" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "webhook_event" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "webhook_endpoint" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."WEBHOOK_DELIVERY_STATUS";
