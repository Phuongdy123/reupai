// This adapter deliberately contains no auth logic. One-click authorization,
// persistent-grant refresh, legacy callback exchange and revoke live in
// LocalEngineClient so every UI surface observes the same connection state.
export class ConnectionManager {
  constructor(client, onChange = () => {}) {
    this.client = client;
    this.state = client.connection.status;
    this.error = client.connection.error;
    this.unsubscribe = client.onChange(({ status, error }) => {
      this.state = status;
      this.error = error;
      onChange({ state: status, error });
    });
  }

  check() { return this.client.check(); }
  authorize() { return this.client.connect(); }
  completeAuthorization(code, state) { return this.client.completeAuthorization(code, state); }
  revoke() { return this.client.revoke(); }
  destroy() { this.unsubscribe?.(); }
}
