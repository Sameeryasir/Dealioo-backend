import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFunnelsTable1778150000000 implements MigrationInterface {
  name = 'AddFunnelsTable1778150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "funnels" (
        "id" SERIAL NOT NULL,
        "campaign_id" integer NOT NULL,
        "lead_name" character varying(255) NOT NULL,
        "lead_email" character varying(255) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_funnels" PRIMARY KEY ("id"),
        CONSTRAINT "FK_funnels_campaign_id" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "funnels"`);
  }
}
