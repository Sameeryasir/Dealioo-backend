import type { EditUiDto } from '../dto/edit-ui.dto';

export const AI_EDIT_UI_QUEUE = 'ai-edit-ui';

export enum AiEditUiJobName {
  EDIT_UI = 'edit-ui',
}

export type AiEditUiJobPayload = EditUiDto;

export const AI_EDIT_UI_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: {
    age: 60 * 60,
    count: 200,
  },
  removeOnFail: {
    age: 24 * 60 * 60,
    count: 200,
  },
};
