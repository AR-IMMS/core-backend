import { Site, type SiteId } from '.././site';
import { DEFAULT_DATA_CENTER_ID, type DataCenterId } from '.././data-center';

describe('Site', () => {
  it('uses a stable default Data Center identity', () => {
    expect(DEFAULT_DATA_CENTER_ID).toBe('dc-default');
  });

  it('trims its name and keeps its Data Center reference when renamed', () => {
    const site = Site.create({
      id: 'site-1' as SiteId,
      name: '  Building A  ',
      dataCenterId: DEFAULT_DATA_CENTER_ID,
    });

    const renamed = site.rename('  Building B  ');

    expect(renamed).toMatchObject({
      id: 'site-1',
      name: 'Building B',
      dataCenterId: 'dc-default',
    });
    expect(site.name).toBe('Building A');
  });

  it('rejects an empty name', () => {
    expect(() =>
      Site.create({
        id: 'site-1' as SiteId,
        name: '  ',
        dataCenterId: 'dc-default' as DataCenterId,
      }),
    ).toThrow('Site name is required');
  });
});
