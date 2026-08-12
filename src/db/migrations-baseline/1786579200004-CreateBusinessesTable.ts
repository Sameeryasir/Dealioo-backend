import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBusinessesTable1786579200004 implements MigrationInterface {
  name = 'CreateBusinessesTable1786579200004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('businesses');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "businesses" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "slug" character varying(120) NOT NULL, "description" text, "logo_url" text, "website_url" character varying(2048), "email" character varying, "phone_number" character varying, "city" character varying, "state" character varying, "country" character varying, "postal_code" character varying, "branch_count" integer NOT NULL DEFAULT '0', "onboarding_completed" boolean NOT NULL DEFAULT false, "onboarding_completed_at" TIMESTAMP WITH TIME ZONE, "stripe_account_id" character varying(255), "meta_user_id" character varying(64), "meta_access_token" text, "meta_connected_at" TIMESTAMP WITH TIME ZONE, "meta_ad_account_id" character varying(64), "meta_connection_status" character varying(32), "meta_token_expires_at" TIMESTAMP WITH TIME ZONE, "meta_oauth_scopes" text, "meta_requested_scopes" text, "google_user_id" character varying(128), "google_refresh_token" text, "google_access_token" text, "google_connected_at" TIMESTAMP WITH TIME ZONE, "google_customer_id" character varying(32), "google_login_customer_id" character varying(32), "google_connection_status" character varying(32), "google_token_expires_at" TIMESTAMP WITH TIME ZONE, "google_oauth_scopes" text, "twilio_phone_number" character varying(32), "twilio_phone_sid" character varying(64), "twilio_connected_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "owner_id" integer NOT NULL, CONSTRAINT "UQ_82ca19bc20713fdfa72626a5da0" UNIQUE ("slug"), CONSTRAINT "PK_bc1bf63498dd2368ce3dc8686e8" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_8881b96819252080592fe1592ea' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "businesses" ADD CONSTRAINT "FK_8881b96819252080592fe1592ea" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "businesses" CASCADE`);
  }
}
