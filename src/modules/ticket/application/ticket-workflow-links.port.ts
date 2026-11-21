/** Owning modules must prove actor access and eligibility through public contracts. */
export interface TicketWorkflowLinksPort {
  confirmedIncident(actor: string, incidentId: string): Promise<boolean>;
  maintenanceActivity(
    actor: string,
    activityId: string,
    ticketId: number,
  ): Promise<boolean>;
  reviewedDraft(
    actor: string,
    draftId: string,
    revision: string,
  ): Promise<{
    readonly incidentId: string;
    readonly title: string;
    readonly description: string;
    readonly assetIds: readonly string[];
  } | null>;
}

export const TICKET_WORKFLOW_LINKS_PORT = Symbol('TICKET_WORKFLOW_LINKS_PORT');
