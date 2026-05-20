import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutomationTables1778800000000 implements MigrationInterface {
  name = 'AddAutomationTables1778800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "automation_trigger_enum" AS ENUM (
          'signup',
          'payment',
          'funnel_completed',
          'abandoned_checkout',
          'first_purchase',
          'no_visit'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "automation_node_type_enum" AS ENUM (
          'trigger',
          'wait',
          'email',
          'sms',
          'whatsapp',
          'condition',
          'coupon',
          'tag'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "automation_execution_purpose_enum" AS ENUM (
          'manual',
          'funnel_signup_payment_reminder',
          'funnel_signup',
          'funnel_payment',
          'funnel_abandoned_checkout_reminder'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "automation" (
        "id" SERIAL NOT NULL,
        "restaurant_id" integer NOT NULL,
        "name" character varying(255) NOT NULL,
        "description" text,
        "trigger" "automation_trigger_enum" NOT NULL,
        "purpose" "automation_execution_purpose_enum" NOT NULL DEFAULT 'funnel_signup_payment_reminder',
        "campaign_id" integer,
        "funnel_id" integer,
        "created_by" integer NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "published" boolean NOT NULL DEFAULT false,
        "is_template" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation" PRIMARY KEY ("id"),
        CONSTRAINT "FK_automation_restaurant_id" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_automation_campaign_id" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_automation_funnel_id" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_automation_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "automation_node" (
        "id" SERIAL NOT NULL,
        "automation_id" integer NOT NULL,
        "type" "automation_node_type_enum" NOT NULL,
        "config" jsonb NOT NULL DEFAULT '{}',
        "position_x" integer NOT NULL DEFAULT 0,
        "position_y" integer NOT NULL DEFAULT 0,
        "node_order" integer NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation_node" PRIMARY KEY ("id"),
        CONSTRAINT "FK_automation_node_automation_id" FOREIGN KEY ("automation_id") REFERENCES "automation"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "automation_connection" (
        "id" SERIAL NOT NULL,
        "automation_id" integer NOT NULL,
        "source_node_id" integer NOT NULL,
        "target_node_id" integer NOT NULL,
        CONSTRAINT "PK_automation_connection" PRIMARY KEY ("id"),
        CONSTRAINT "FK_automation_connection_automation_id" FOREIGN KEY ("automation_id") REFERENCES "automation"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_automation_connection_source_node_id" FOREIGN KEY ("source_node_id") REFERENCES "automation_node"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_automation_connection_target_node_id" FOREIGN KEY ("target_node_id") REFERENCES "automation_node"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "automation_execution" (
        "id" SERIAL NOT NULL,
        "automation_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "current_node_id" integer NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'running',
        "scheduled_at" TIMESTAMPTZ,
        "purpose" "automation_execution_purpose_enum" NOT NULL DEFAULT 'manual',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation_execution" PRIMARY KEY ("id"),
        CONSTRAINT "FK_automation_execution_automation_id" FOREIGN KEY ("automation_id") REFERENCES "automation"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_automation_execution_customer_id" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_automation_execution_current_node_id" FOREIGN KEY ("current_node_id") REFERENCES "automation_node"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "automation_log" (
        "id" SERIAL NOT NULL,
        "execution_id" integer NOT NULL,
        "node_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "message" text NOT NULL,
        "error" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation_log" PRIMARY KEY ("id"),
        CONSTRAINT "FK_automation_log_execution_id" FOREIGN KEY ("execution_id") REFERENCES "automation_execution"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_automation_log_node_id" FOREIGN KEY ("node_id") REFERENCES "automation_node"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_automation_log_customer_id" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "automation"
      ADD COLUMN IF NOT EXISTS "purpose" "automation_execution_purpose_enum" NOT NULL DEFAULT 'funnel_signup_payment_reminder'
    `);
    await queryRunner.query(`
      ALTER TABLE "automation_node"
      ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
    `);
    await queryRunner.query(`
      ALTER TABLE "automation_execution"
      ADD COLUMN IF NOT EXISTS "purpose" "automation_execution_purpose_enum" NOT NULL DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_log"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_execution"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_connection"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_node"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "automation"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "automation_execution_purpose_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "automation_node_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "automation_trigger_enum"`);
  }
}
