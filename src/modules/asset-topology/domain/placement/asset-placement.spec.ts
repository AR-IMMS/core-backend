import { AssetPlacement } from './asset-placement';
import { DomainError } from '../shared/domain-error';

describe('AssetPlacement', () => {
  const startTime = new Date('2026-01-01T10:00:00.000Z');

  it('records one Asset in one Rack U position', () => {
    const placement = AssetPlacement.start({
      id: 'placement-1',
      assetId: 'asset-1',
      rackId: 'rack-1',
      uPosition: 12,
      placedAt: startTime,
    });

    expect(placement.assetId).toBe('asset-1');
    expect(placement.rackId).toBe('rack-1');
    expect(placement.uPosition.value).toBe(12);
    expect(placement.isActive).toBe(true);
  });

  it('rejects U positions below 1', () => {
    expect(() =>
      AssetPlacement.start({
        id: 'placement-1',
        assetId: 'asset-1',
        rackId: 'rack-1',
        uPosition: 0,
        placedAt: startTime,
      }),
    ).toThrow(DomainError);
  });

  it('closes the old placement when the Asset moves or is unmapped', () => {
    const placement = AssetPlacement.start({
      id: 'placement-1',
      assetId: 'asset-1',
      rackId: 'rack-1',
      uPosition: 12,
      placedAt: startTime,
    });

    const ended = placement.close(new Date('2026-01-10T10:00:00.000Z'));

    expect(placement.isActive).toBe(true);
    expect(ended.isActive).toBe(false);
    expect(ended.validTo?.toISOString()).toBe('2026-01-10T10:00:00.000Z');
  });

  it('rejects closing a placement before it started', () => {
    const placement = AssetPlacement.start({
      id: 'placement-1',
      assetId: 'asset-1',
      rackId: 'rack-1',
      uPosition: 12,
      placedAt: startTime,
    });

    expect(() => placement.close(new Date('2025-12-31T10:00:00.000Z'))).toThrow(
      'Placement end time must be after start time',
    );
  });
});
