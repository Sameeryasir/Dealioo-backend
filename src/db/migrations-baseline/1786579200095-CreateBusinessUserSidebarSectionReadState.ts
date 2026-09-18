import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBusinessUserSidebarSectionReadState1786579200095
  implements MigrationInterface
{
  name = 'CreateBusinessUserSidebarSectionReadState1786579200095';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "business_user_sidebar_section_read_state" (
        "id" SERIAL NOT NULL,
        "user_id" integer NOT NULL,
        "business_id" integer NOT NULL,
        "section" character varying(20) NOT NULL,
        "last_viewed_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_business_user_sidebar_section_read_state" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sidebar_section_read_user_business_section"
          UNIQUE ("user_id", "business_id", "section"),
        CONSTRAINT "FK_sidebar_section_read_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_sidebar_section_read_business_id"
          FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "CHK_sidebar_section_read_section"
          CHECK ("section" IN ('orders', 'activity', 'history'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sidebar_section_read_business_id"
        ON "business_user_sidebar_section_read_state" ("business_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_sidebar_section_read_business_id"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "business_user_sidebar_section_read_state"
    `);
  }
}
