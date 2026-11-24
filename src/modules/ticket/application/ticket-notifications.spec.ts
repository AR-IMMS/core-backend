import { notificationFor, TicketNotifications } from './ticket-notifications';
import type { ExternalTicket } from './ticket-read.port';

const ticket: ExternalTicket = {
  externalTicketId: 42,
  groupId: 2,
  nativeOwnerId: 5,
  businessOwner: { kind: 'reference', externalUserId: 4 },
  number: '10042',
  title: 'Authorized title',
  customerId: 7,
  stateId: 2,
  priorityId: 2,
  createdAt: '2026-11-24T00:00:00Z',
  updatedAt: '2026-11-24T00:00:00Z',
};
const received = {
  id: 'notification-1',
  ticketId: 42,
  kind: 'article_added' as const,
  occurredAt: ticket.createdAt,
  read: false,
};

function setup() {
  const access = {
    authorizeActor: jest
      .fn()
      .mockResolvedValue({ mapping: { zammadUserId: 5 } }),
    execute: jest.fn(),
  };
  const store = {
    notificationCandidates: jest.fn(),
    markNotificationsRead: jest.fn().mockResolvedValue(1),
  };
  const inbox = new TicketNotifications(access, store, {
    instanceKey: 'poc',
    approvedGroupId: 2,
  });
  return { access, store, inbox };
}

describe('Ticket notification authorization', () => {
  it('snapshots each current participant once', () => {
    expect(notificationFor('created', ticket)?.recipients).toEqual([5, 4]);
    expect(
      notificationFor('created', { ...ticket, nativeOwnerId: 4 })?.recipients,
    ).toEqual([4]);
  });

  it('rechecks current resource visibility before exposing item metadata or unread counts', async () => {
    const { inbox, access, store } = setup();
    store.notificationCandidates.mockResolvedValue([
      received,
      { ...received, id: 'revoked', ticketId: 43 },
    ]);
    access.execute
      .mockResolvedValueOnce({ status: 'allowed', ticket })
      .mockResolvedValueOnce({ status: 'denied' });
    expect(await inbox.list('reader')).toEqual({
      items: [
        {
          id: received.id,
          kind: 'article_added',
          ticket_id: 42,
          ticket_number: '10042',
          ticket_title: 'Authorized title',
          occurred_at: received.occurredAt,
          read: false,
        },
      ],
      unread_count: 1,
    });
    expect(store.notificationCandidates).toHaveBeenCalledWith(
      { instance: 'poc', group: 2, externalUserId: 5, actor: 'reader' },
      20,
      undefined,
    );
  });

  it('fails closed before reading the inbox when the actor is excluded', async () => {
    const { inbox, access, store } = setup();
    access.authorizeActor.mockResolvedValue(null);
    await expect(inbox.list('excluded')).rejects.toMatchObject({
      code: 'DENIED',
    });
    expect(store.notificationCandidates).not.toHaveBeenCalled();
  });

  it('only updates read state after all supplied items are confirmed visible', async () => {
    const { inbox, access, store } = setup();
    store.notificationCandidates.mockResolvedValue([received]);
    access.execute.mockResolvedValue({ status: 'denied' });
    await expect(inbox.markRead('reader', [received.id])).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
    expect(store.markNotificationsRead).not.toHaveBeenCalled();
    access.execute.mockResolvedValue({ status: 'allowed', ticket });
    expect(await inbox.markRead('reader', [received.id])).toEqual({
      updated_count: 1,
    });
  });
});
