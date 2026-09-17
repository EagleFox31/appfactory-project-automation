export class BrokerError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.name = 'BrokerError';
    this.status = status;
    this.code = code;
  }
}

export function boundedError(error) {
  if (error instanceof BrokerError) return error;
  console.error('Unhandled broker failure', {
    name: error?.name,
    message: error?.message
  });
  return new BrokerError(500, 'internal_error', 'The token broker could not complete the request.');
}
