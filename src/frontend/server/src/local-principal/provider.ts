/** Supplies the migration-owned installation principal to the local gateway. */
export interface InstallationPrincipalProvider {
  getInstallationPrincipalId(): Promise<string>;
}
