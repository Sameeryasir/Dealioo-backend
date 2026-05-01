import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOtpTable1777420625912 implements MigrationInterface {
  name = 'AddOtpTable1777420625912';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "otps" (
                "id" SERIAL NOT NULL,
                "code" character varying NOT NULL,
                "is_used" boolean NOT NULL DEFAULT false,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "expires_at" TIMESTAMP WITH TIME ZONE,
                "user_id" integer NOT NULL,
                CONSTRAINT "PK_otps" PRIMARY KEY ("id"),
                CONSTRAINT "FK_otps_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
            )
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "otps"`);
  }
}
