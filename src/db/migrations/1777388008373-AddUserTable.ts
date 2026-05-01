import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserTable1777388008373 implements MigrationInterface {
  name = 'AddUserTable1777388008373';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "users" (
            "id" SERIAL NOT NULL, 
            "name" character varying NOT NULL, 
            "email" character varying NOT NULL, 
            "phone" character varying NOT NULL, 
            "email_verified" boolean NOT NULL DEFAULT false, 
            "phone_verified" boolean NOT NULL DEFAULT false, 
            "password_hash" character varying NOT NULL, 
            "is_active" boolean NOT NULL DEFAULT true, 
            "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), 
            "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(), 
            "created_by" integer, -- Adding created_by as a foreign key
            CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), 
            CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"),
            CONSTRAINT "FK_7d7e4c2f1c1b1f3b02f7c5c2eb6" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
        )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
