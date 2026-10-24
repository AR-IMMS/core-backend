import { DomainError } from '../../shared/domain-error';
import {
  RackMapPlacement,
  RackMapPlacementErrorCode,
  RackRotation,
} from '../rack-map-placement';

describe('RackMapPlacement', () => {
  it('stores an integer one-cell coordinate and supported rotation', () => {
    const placement = RackMapPlacement.create({
      rackId: 'rack-1',
      column: 2,
      row: 4,
      rotation: 90,
    });
    expect(placement).toMatchObject({
      rackId: 'rack-1',
      column: 2,
      row: 4,
      rotation: 90,
    });
  });

  it.each([-1, 1.2])('rejects invalid column %s', (column) => {
    expect(() =>
      RackMapPlacement.create({
        rackId: 'rack-1',
        column,
        row: 0,
        rotation: 0,
      }),
    ).toThrow(DomainError);
  });

  it.each([0, 90, 180, 270] as const)(
    'accepts cardinal rotation %i without changing its one-cell coordinate',
    (rotation: RackRotation) => {
      expect(
        RackMapPlacement.create({
          rackId: 'rack-1',
          column: 1,
          row: 3,
          rotation,
        }),
      ).toMatchObject({ column: 1, row: 3, rotation });
    },
  );

  it('rejects unsupported rotation values', () => {
    try {
      RackMapPlacement.create({
        rackId: 'rack-1',
        column: 0,
        row: 0,
        rotation: 45 as RackRotation,
      });
      throw new Error('Expected invalid rotation to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({
        code: RackMapPlacementErrorCode.INVALID_ROTATION,
      });
    }
  });
});
