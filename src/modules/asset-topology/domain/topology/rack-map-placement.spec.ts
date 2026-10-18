import { DomainError } from '../shared/domain-error';
import {
  RackMapPlacement,
  RackMapPlacementErrorCode,
  RackRotation,
} from './rack-map-placement';

describe('RackMapPlacement', () => {
  const createPlacement = (rotation: RackRotation) =>
    RackMapPlacement.create({
      rackId: 'rack-1',
      xMm: 0,
      yMm: 0,
      widthMm: 600,
      depthMm: 1_000,
      rotation,
    });

  it.each([
    [0, 600, 1_000],
    [90, 1_000, 600],
    [180, 600, 1_000],
    [270, 1_000, 600],
  ] as const)(
    'accepts rotation %i and calculates its effective footprint',
    (rotation, expectedWidthMm, expectedDepthMm) => {
      const placement = createPlacement(rotation);

      expect(placement.rotation).toBe(rotation);
      expect(placement.effectiveWidthMm).toBe(expectedWidthMm);
      expect(placement.effectiveDepthMm).toBe(expectedDepthMm);
    },
  );

  it('rejects a runtime rotation that is not a supported angle', () => {
    try {
      createPlacement(45 as RackRotation);
      throw new Error('Expected placement creation to reject the rotation');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({
        code: RackMapPlacementErrorCode.INVALID_ROTATION,
      });
    }
  });
});
