import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameRestaurantIdToBusinessIdEverywhere1779750000000
  implements MigrationInterface
{
  name = 'RenameRestaurantIdToBusinessIdEverywhere1779750000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        col_rec RECORD;
        fk_rec RECORD;
        new_column_name text;
        new_constraint_name text;
        saved_delete_rule text;
      BEGIN
        FOR col_rec IN
          SELECT
            c.table_name,
            c.column_name
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.column_name IN (
              'restaurant_id',
              'sent_by_restaurant_id',
              'sent_to_restaurant_id'
            )
          ORDER BY c.table_name, c.column_name
        LOOP
          new_column_name := CASE col_rec.column_name
            WHEN 'restaurant_id' THEN 'business_id'
            WHEN 'sent_by_restaurant_id' THEN 'sent_by_business_id'
            WHEN 'sent_to_restaurant_id' THEN 'sent_to_business_id'
          END;

          IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = col_rec.table_name
              AND column_name = new_column_name
          ) THEN
            CONTINUE;
          END IF;

          saved_delete_rule := NULL;

          FOR fk_rec IN
            SELECT
              tc.constraint_name,
              rc.delete_rule
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            JOIN information_schema.referential_constraints rc
              ON rc.constraint_name = tc.constraint_name
             AND rc.constraint_schema = tc.table_schema
            WHERE tc.table_schema = 'public'
              AND tc.table_name = col_rec.table_name
              AND tc.constraint_type = 'FOREIGN KEY'
              AND kcu.column_name = col_rec.column_name
          LOOP
            saved_delete_rule := fk_rec.delete_rule;
            EXECUTE format(
              'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
              col_rec.table_name,
              fk_rec.constraint_name
            );
          END LOOP;

          EXECUTE format(
            'ALTER TABLE %I RENAME COLUMN %I TO %I',
            col_rec.table_name,
            col_rec.column_name,
            new_column_name
          );

          IF saved_delete_rule IS NOT NULL THEN
            new_constraint_name := format(
              'FK_%s_%s',
              col_rec.table_name,
              new_column_name
            );

            BEGIN
              EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES businesses(id) ON DELETE %s',
                col_rec.table_name,
                new_constraint_name,
                new_column_name,
                saved_delete_rule
              );
            EXCEPTION
              WHEN duplicate_object THEN
                NULL;
            END;
          END IF;
        END LOOP;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        col_rec RECORD;
        fk_rec RECORD;
        old_column_name text;
        saved_delete_rule text;
        new_constraint_name text;
      BEGIN
        FOR col_rec IN
          SELECT
            c.table_name,
            c.column_name
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND (
              (c.column_name = 'business_id' AND c.table_name IN (
                'activity_event',
                'automation',
                'campaigns',
                'checkout_access_token',
                'conversation',
                'customer_journey_events',
                'customer_visits',
                'facebook_campaign_mappings',
                'facebook_campaigns',
                'funnel_order',
                'funnel_payment',
                'integration_audit_logs',
                'locations',
                'meta_campaign_drafts',
                'meta_campaign_errors',
                'meta_campaign_media',
                'meta_publish_attempts',
                'orders',
                'redemption_logs',
                'restaurant_user_chat_read_state'
              ))
              OR (
                c.column_name IN ('sent_by_business_id', 'sent_to_business_id')
                AND c.table_name = 'conversation_message'
              )
            )
          ORDER BY c.table_name, c.column_name
        LOOP
          old_column_name := CASE col_rec.column_name
            WHEN 'business_id' THEN 'restaurant_id'
            WHEN 'sent_by_business_id' THEN 'sent_by_restaurant_id'
            WHEN 'sent_to_business_id' THEN 'sent_to_restaurant_id'
          END;

          IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = col_rec.table_name
              AND column_name = old_column_name
          ) THEN
            CONTINUE;
          END IF;

          saved_delete_rule := NULL;

          FOR fk_rec IN
            SELECT
              tc.constraint_name,
              rc.delete_rule
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            JOIN information_schema.referential_constraints rc
              ON rc.constraint_name = tc.constraint_name
             AND rc.constraint_schema = tc.table_schema
            WHERE tc.table_schema = 'public'
              AND tc.table_name = col_rec.table_name
              AND tc.constraint_type = 'FOREIGN KEY'
              AND kcu.column_name = col_rec.column_name
          LOOP
            saved_delete_rule := fk_rec.delete_rule;
            EXECUTE format(
              'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
              col_rec.table_name,
              fk_rec.constraint_name
            );
          END LOOP;

          EXECUTE format(
            'ALTER TABLE %I RENAME COLUMN %I TO %I',
            col_rec.table_name,
            col_rec.column_name,
            old_column_name
          );

          IF saved_delete_rule IS NOT NULL THEN
            new_constraint_name := format(
              'FK_%s_%s',
              col_rec.table_name,
              old_column_name
            );

            BEGIN
              EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES businesses(id) ON DELETE %s',
                col_rec.table_name,
                new_constraint_name,
                old_column_name,
                saved_delete_rule
              );
            EXCEPTION
              WHEN duplicate_object THEN
                NULL;
            END;
          END IF;
        END LOOP;
      END $$;
    `);
  }
}
