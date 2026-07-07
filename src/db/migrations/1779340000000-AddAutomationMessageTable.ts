import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutomationMessageTable1779340000000
  implements MigrationInterface
{
  name = 'AddAutomationMessageTable1779340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "automation_message" (
        "id" SERIAL NOT NULL,
        "restaurant_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "automation_id" integer,
        "execution_id" integer,
        "node_id" integer,
        "channel" character varying(16) NOT NULL,
        "direction" character varying(16) NOT NULL DEFAULT 'outbound',
        "body_preview" text NOT NULL,
        "metadata" jsonb,
        "sent_at" TIMESTAMPTZ NOT NULL,
        "idempotency_key" character varying(160) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation_message" PRIMARY KEY ("id"),
        CONSTRAINT "FK_automation_message_restaurant_id"
          FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_automation_message_customer_id"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_automation_message_automation_id"
          FOREIGN KEY ("automation_id") REFERENCES "automation"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_automation_message_execution_id"
          FOREIGN KEY ("execution_id") REFERENCES "automation_execution"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_automation_message_node_id"
          FOREIGN KEY ("node_id") REFERENCES "automation_node"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_message"`);
  }
}
