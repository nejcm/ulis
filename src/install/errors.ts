export class InstallError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "InstallError";
  }
}
