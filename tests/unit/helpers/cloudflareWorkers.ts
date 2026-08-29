export abstract class WorkerEntrypoint<Env> {
  protected readonly env: Env

  constructor(_context: unknown, env: Env) {
    this.env = env
  }
}
