import { DomainError } from '../../shared/domain-error';
import { RackUnitPosition } from '../../placement/rack-unit-position';
import { Rack } from '.././rack';

describe('Rack', () => {
  it.each([0, -1, 1.5])('rejects U capacity %s', (uCapacity) => {
    expect(() => Rack.create({ id: 'rack-1', uCapacity })).toThrow(DomainError);
  });

  it('requires a Rack identity', () => {
    expect(() => Rack.create({ id: '  ', uCapacity: 42 })).toThrow(DomainError);
  });

  it('accepts the first and last U positions within capacity', () => {
    const rack = Rack.create({ id: 'rack-1', uCapacity: 42 });

    expect(() =>
      rack.validateUPosition(RackUnitPosition.from(1)),
    ).not.toThrow();
    expect(() =>
      rack.validateUPosition(RackUnitPosition.from(42)),
    ).not.toThrow();
  });

  it('updates only permitted Rack fields and can clear labels without changing identity', () => {
    const rack = Rack.create({
      id: 'rack-1',
      uCapacity: 42,
      rowLabel: ' A ',
      positionInRow: ' 03 ',
    });

    const updated = rack.update({ rowLabel: null, positionInRow: '04' });

    expect(updated).toMatchObject({
      id: 'rack-1',
      uCapacity: 42,
      rowLabel: undefined,
      positionInRow: '04',
    });
  });

  it('rejects U positions above capacity', () => {
    const rack = Rack.create({ id: 'rack-1', uCapacity: 42 });

    expect(() => rack.validateUPosition(RackUnitPosition.from(43))).toThrow(
      DomainError,
    );
  });

  it.each([0, -1, 1.5])('rejects invalid 1-based U position %s', (position) => {
    expect(() => RackUnitPosition.from(position)).toThrow(DomainError);
  });
});
