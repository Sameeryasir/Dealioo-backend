import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_RULE_MESSAGE =
  'Password must be at least 8 characters and include an uppercase letter and a number.';

export function isStrongEnoughPassword(password: string): boolean {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return false;
  }
  if (!/[A-Z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  return true;
}

@ValidatorConstraint({ name: 'isStrongEnoughPassword', async: false })
export class IsStrongEnoughPasswordConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown): boolean {
    return typeof value === 'string' && isStrongEnoughPassword(value);
  }

  defaultMessage(): string {
    return PASSWORD_RULE_MESSAGE;
  }
}

export function IsStrongEnoughPassword(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsStrongEnoughPasswordConstraint,
    });
  };
}

export function normalizeAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}
