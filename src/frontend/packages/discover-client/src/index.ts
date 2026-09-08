/** Proposed contract families only: no Discover wire protocol is ratified yet. */
export const proposedDiscoverContracts = {
  public: "animama-discover-public/1",
  creator: "animama-discover-creator/1",
  installedAccountConnection: "animama-installed-account-connection/1",
  portable: "animama-discover-portable/1",
} as const;

export type ProposedDiscoverContract =
  (typeof proposedDiscoverContracts)[keyof typeof proposedDiscoverContracts];

/** Consumers must not mistake package availability for protocol acceptance. */
export const discoverContractStatus = "proposed-unratified" as const;
