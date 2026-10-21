import { createRackSchema, updateRackSchema } from '../rack.schemas';

describe('Rack request schemas', () => {
  const createRequest = {
    name: 'Core Rack',
    column: 3,
    row: 3,
    rotation: 0,
    u_capacity: 42,
  };

  it('requires a non-empty Rack name at creation', () => {
    expect(
      createRackSchema.safeParse({ ...createRequest, name: '  ' }).success,
    ).toBe(false);
  });

  it.each(['row_label', 'position_in_row'])(
    'rejects legacy %s request fields',
    (field) => {
      expect(
        createRackSchema.safeParse({ ...createRequest, [field]: 'A' }).success,
      ).toBe(false);
      expect(updateRackSchema.safeParse({ [field]: 'A' }).success).toBe(false);
    },
  );
});
