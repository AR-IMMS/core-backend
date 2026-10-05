import type { ZodIssue } from 'zod/v4';

/**
 * Stable validation codes exposed by the Core API.
 */
export type ValidationErrorCode =
  | 'INVALID_TYPE'
  | 'INVALID_FORMAT'
  | 'OUT_OF_RANGE'
  | 'UNKNOWN_FIELD'
  | 'INVALID_VALUE';

/**
 * A public validation error that does not expose Zod-specific issue metadata.
 */
export interface ValidationFieldError {
  path: Array<string | number>;
  code: ValidationErrorCode;
  message: string;
}

/**
 * Maps Zod issues to the stable validation error contract used by the API.
 */
export function mapZodIssues(
  issues: readonly ZodIssue[],
): ValidationFieldError[] {
  return issues.flatMap((issue): ValidationFieldError[] => {
    const path = issue.path.map(toPathSegment);

    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        path: [...path, key],
        code: 'UNKNOWN_FIELD',
        message: 'Unknown field.',
      }));
    }

    return [
      {
        path,
        code: mapIssueCode(issue),
        message: issue.message,
      },
    ];
  });
}

function toPathSegment(segment: PropertyKey): string | number {
  return typeof segment === 'symbol'
    ? (segment.description ?? segment.toString())
    : segment;
}

function mapIssueCode(issue: ZodIssue): ValidationErrorCode {
  switch (issue.code) {
    case 'invalid_type':
      return 'INVALID_TYPE';
    case 'invalid_format':
      return 'INVALID_FORMAT';
    case 'too_small':
    case 'too_big':
      return 'OUT_OF_RANGE';
    default:
      return 'INVALID_VALUE';
  }
}
