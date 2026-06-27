import { registerDecorator, ValidationOptions } from 'class-validator';

const PRIVATE_IP_REGEX =
  /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)/i;

export function IsSafeUrl(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isSafeUrl',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          if (value.length > 2048) return false;
          if (!value.startsWith('http://') && !value.startsWith('https://'))
            return false;
          if (PRIVATE_IP_REGEX.test(value)) return false;
          return true;
        },
        defaultMessage: () =>
          'URL must be a valid public http/https URL under 2048 characters',
      },
    });
  };
}
