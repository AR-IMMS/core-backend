import { DomainError } from '../../shared/domain-error';
import { RackUnitPosition } from '../../placement/rack-unit-position';
import { Rack } from '.././rack';

describe('Rack', () => {
  it.each([0, -1, 1.5])('rejects U capacity %s', (uCapacity) => {
    expect(() =>
      Rack.create({ id: 'rack-1', name: 'Core Rack', uCapacity }),
    ).toThrow(DomainError);
  });

  it('requires a Rack identity', () => {
    expect(() =>
      Rack.create({ id: '  ', name: 'Core Rack', uCapacity: 42 }),
    ).toThrow(DomainError);
  });

  it('requires a non-empty Rack name', () => {
    expect(() =>
      Rack.create({ id: 'rack-1', uCapacity: 42, name: '  ' }),
    ).toThrow(DomainError);
  });

  it('trims Rack names at creation', () => {
    const rack = Rack.create({
      id: 'rack-1',
      name: ' Core Rack ',
      uCapacity: 42,
    });

    expect(rack.name).toBe('Core Rack');
  });

  it('accepts the first and last U positions within capacity', () => {
    const rack = Rack.create({
      id: 'rack-1',
      name: 'Core Rack',
      uCapacity: 42,
    });

    expect(() =>
      rack.validateUPosition(RackUnitPosition.from(1)),
    ).not.toThrow();
    expect(() =>
      rack.validateUPosition(RackUnitPosition.from(42)),
    ).not.toThrow();
  });

  it('updates capacity without changing the Rack name or identity', () => {
    const rack = Rack.create({
      id: 'rack-1',
      uCapacity: 42,
      name: ' Core Rack ',
    });

    const updated = rack.update({ uCapacity: 48 });

    expect(updated).toMatchObject({
      id: 'rack-1',
      name: 'Core Rack',
      uCapacity: 48,
    });
  });

  it('rejects U positions above capacity', () => {
    const rack = Rack.create({
      id: 'rack-1',
      name: 'Core Rack',
      uCapacity: 42,
    });

    expect(() => rack.validateUPosition(RackUnitPosition.from(43))).toThrow(
      DomainError,
    );
  });

  it.each([0, -1, 1.5])('rejects invalid 1-based U position %s', (position) => {
    expect(() => RackUnitPosition.from(position)).toThrow(DomainError);
  });
});
