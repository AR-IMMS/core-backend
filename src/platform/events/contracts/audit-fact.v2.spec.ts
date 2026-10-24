import { parseAuditFactPayloadV2 } from './audit-fact.v2';

const permissionCodes = new Set(['user:read', 'asset:read']);
const isPermissionCode = (code: string): boolean => permissionCodes.has(code);

describe('parseAuditFactPayloadV2', () => {
  /** It keeps scalar values and flat string arrays in their original JSON types. */
  test('parses scalar changes and permission arrays without coercion', () => {
    const payload = {
      actor: { type: 'user', id: 'admin-1' },
      action: 'iam.user.permissions_replaced',
      changes: [
        { field: 'role', before: 'OPERATOR', after: 'TECHNICIAN' },
        {
          field: 'additional_permissions',
          before: ['user:read'],
          after: ['asset:read', 'user:read'],
        },
        { field: 'labels', before: ['old', 'blue'], after: ['green'] },
      ],
    };

    expect(parseAuditFactPayloadV2(payload, isPermissionCode)).toEqual(payload);
  });

  /** It rejects arrays containing non-strings or nested values. */
  test.each([
    [1, 'number'],
    [null, 'null'],
    [{ code: 'user:read' }, 'object'],
    [['user:read'], 'nested array'],
  ])('rejects an array with a %s element', (entry, _description) => {
    void _description;
    expect(() =>
      parseAuditFactPayloadV2(
        {
          actor: { type: 'user', id: 'admin-1' },
          action: 'iam.user.updated',
          changes: [{ field: 'labels', after: [entry] }],
        },
        isPermissionCode,
      ),
    ).toThrow('must be an array of strings');
  });

  /** It requires every additional permission code to exist in the IAM catalog. */
  test('rejects a permission code outside the catalog', () => {
    expect(() =>
      parseAuditFactPayloadV2(
        {
          actor: { type: 'user', id: 'admin-1' },
          action: 'iam.user.permissions_replaced',
          changes: [
            { field: 'additional_permissions', after: ['user:unknown'] },
          ],
        },
        isPermissionCode,
      ),
    ).toThrow('is not in the permission catalog');
  });

  /** It rejects repeated permission codes within either permission-set value. */
  test('rejects duplicate permission codes', () => {
    expect(() =>
      parseAuditFactPayloadV2(
        {
          actor: { type: 'user', id: 'admin-1' },
          action: 'iam.user.permissions_replaced',
          changes: [
            {
              field: 'additional_permissions',
              before: ['user:read', 'user:read'],
            },
          ],
        },
        isPermissionCode,
      ),
    ).toThrow('contains duplicate permission codes');
  });

  /** It rejects duplicate change fields so each field has one unambiguous transition. */
  test('rejects a repeated change field', () => {
    expect(() =>
      parseAuditFactPayloadV2(
        {
          actor: { type: 'user', id: 'admin-1' },
          action: 'iam.user.updated',
          changes: [
            { field: 'status', before: 'disabled' },
            { field: 'status', after: 'enabled' },
          ],
        },
        isPermissionCode,
      ),
    ).toThrow('Audit change field "status" is repeated');
  });

  /** It requires both present sides of an additional-permissions change to be arrays. */
  test('rejects a scalar value for the reserved permission-set field', () => {
    expect(() =>
      parseAuditFactPayloadV2(
        {
          actor: { type: 'user', id: 'admin-1' },
          action: 'iam.user.permissions_replaced',
          changes: [
            {
              field: 'additional_permissions',
              before: ['user:read'],
              after: 'asset:read',
            },
          ],
        },
        isPermissionCode,
      ),
    ).toThrow('must be an array of permission codes');
  });

  /** It bounds each permission set to 64 catalog entries. */
  test('rejects permission arrays with more than 64 entries', () => {
    const codes = Array.from({ length: 65 }, (_, index) => `code:${index}`);

    expect(() =>
      parseAuditFactPayloadV2(
        {
          actor: { type: 'user', id: 'admin-1' },
          action: 'iam.user.permissions_replaced',
          changes: [{ field: 'additional_permissions', after: codes }],
        },
        () => true,
      ),
    ).toThrow('may not contain more than 64 entries');
  });

  /** It rejects oversized payloads before validating their nested contents. */
  test('rejects payloads larger than 16 KiB', () => {
    expect(() =>
      parseAuditFactPayloadV2(
        {
          actor: { type: 'user', id: 'x'.repeat(16 * 1024) },
          action: 'iam.user.updated',
          changes: [],
        },
        isPermissionCode,
      ),
    ).toThrow('must not exceed 16384 UTF-8 bytes');
  });

  /** It rejects sensitive property names and unrestricted snapshots. */
  test.each(['passwordHash', 'refreshToken', 'user_snapshot'])(
    'rejects the sensitive or snapshot field %s',
    (field) => {
      expect(() =>
        parseAuditFactPayloadV2(
          {
            actor: { type: 'user', id: 'admin-1' },
            action: 'iam.user.updated',
            changes: [{ field, after: 'not safe' }],
          },
          isPermissionCode,
        ),
      ).toThrow();
    },
  );
});
