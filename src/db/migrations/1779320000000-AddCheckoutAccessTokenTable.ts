import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCheckoutAccessTokenTable1779320000000
  implements MigrationInterface
{
  name = 'AddCheckoutAccessTokenTable1779320000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "checkout_access_token" (
        "id" SERIAL NOT NULL,
        "token_hash" character varying(64) NOT NULL,
        "customer_id" integer NOT NULL,
        "funnel_id" integer NOT NULL,
        "restaurant_id" integer NOT NULL,
        "campaign_id" integer,
        "funnel_payment_id" integer,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_checkout_access_token" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_checkout_access_token_hash" UNIQUE ("token_hash"),
        CONSTRAINT "FK_checkout_access_token_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_checkout_access_token_funnel_payment" FOREIGN KEY ("funnel_payment_id") REFERENCES "funnel_payment"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_checkout_access_token_customer_funnel"
      ON "checkout_access_token" ("customer_id", "funnel_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "checkout_access_token"
    `);
  }
}
