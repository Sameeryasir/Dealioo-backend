import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMeetingEmailChallengesTable1786579200154 implements MigrationInterface {
  name = 'CreateMeetingEmailChallengesTable1786579200154';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('meeting_email_challenges');
    if (!hasTable) {
      await queryRunner.query(`
        CREATE TABLE "meeting_email_challenges" (
          "id" SERIAL NOT NULL,
          "email" character varying(255) NOT NULL,
          "code" character varying(16) NOT NULL,
          "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
          "is_used" boolean NOT NULL DEFAULT false,
          "proof_token_hash" character varying(64),
          "proof_expires_at" TIMESTAMP WITH TIME ZONE,
          "proof_used_at" TIMESTAMP WITH TIME ZONE,
          "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "PK_meeting_email_challenges" PRIMARY KEY ("id")
        )
      `);
    }

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_meeting_email_challenges_email"
        ON "meeting_email_challenges" ("email")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_meeting_email_challenges_proof_token_hash"
        ON "meeting_email_challenges" ("proof_token_hash")
        WHERE "proof_token_hash" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "meeting_email_challenges" CASCADE`,
    );
  }
}
