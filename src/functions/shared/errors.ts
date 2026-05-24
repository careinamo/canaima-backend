import type { APIGatewayProxyResultV2 } from 'aws-lambda';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function toErrorResponse(error: any): APIGatewayProxyResultV2 {
  console.error('Error:', error);

  if (error instanceof HttpError) {
    return {
      statusCode: error.statusCode,
      body: JSON.stringify({
        error: error.message,
        code: error.code,
      }),
    };
  }

  // Zod validation error
  if (error.name === 'ZodError') {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Validation failed',
        details: error.errors,
      }),
    };
  }

  // Unknown error
  return {
    statusCode: 500,
    body: JSON.stringify({
      error: 'Internal server error',
    }),
  };
}
