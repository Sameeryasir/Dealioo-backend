import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBusinessHistoryTable1779650000000
  implements MigrationInterface
{
  name = 'AddBusinessHistoryTable1779650000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "business_history" (
        "id" SERIAL NOT NULL,
        "business_id" integer,
        "event_type" character varying(40) NOT NULL,
        "description" text NOT NULL,
        "actor_user_id" integer,
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_business_history" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_business_history_idempotency" UNIQUE ("idempotency_key"),
        CONSTRAINT "FK_business_history_business" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_business_history_actor_user" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_business_history_business_occurred"
      ON "business_history" ("business_id", "occurred_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_business_history_business_occurred"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "business_history"`);
  }
}
